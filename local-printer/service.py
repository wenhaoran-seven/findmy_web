"""Loopback-only PC43t print bridge. No browser dialogs; never equate dispatch with paper output."""
import json,math,sqlite3,threading,time,uuid,os,ctypes,logging,sys
from ctypes import wintypes
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import win32print,win32gui,win32ui,win32con
from PIL import Image,ImageDraw,ImageFont,ImageWin
import qrcode
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse,Response
from pydantic import BaseModel,Field
from typing import Literal
ROOT=Path(__file__).resolve().parent
DATA=Path(os.environ.get('FINDMY_PRINTER_DATA') or (str(Path(os.environ['LOCALAPPDATA'])/'FindMyPrint') if getattr(sys,'frozen',False) else str(ROOT/'data')));DATA.mkdir(parents=True,exist_ok=True)
DB=DATA/'jobs.sqlite3'
ORIGINS={'https://47.106.211.14','https://47.106.211.14:18444','https://47.106.211.14:18445','https://47.106.211.14:18446','http://127.0.0.1:8767','http://127.0.0.1:8769','http://127.0.0.1:8771','http://127.0.0.1:8870','https://47.106.211.14:18443'}
lock=threading.Lock();pool=ThreadPoolExecutor(max_workers=1)
with sqlite3.connect(DB) as c:
 c.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, spool_id INTEGER, created REAL)')

class Job(BaseModel):
 id:uuid.UUID
 sn:str=Field(pattern=r'^\d{12}$')
 mac:str=Field(pattern=r'^[0-9A-F]{12}$')
 device_name:str=Field(min_length=1,max_length=80)
 width:float=Field(default=10,ge=10,le=20)
 height:float=Field(default=10,ge=10,le=100)
 gap:float=Field(default=2,ge=0,le=5)
 row_gap:float=Field(default=2,ge=0,le=10)
 columns:int=Field(default=5,ge=1,le=10)
 margin_left:float=Field(default=1,ge=0,le=20)
 margin_right:float=Field(default=1,ge=0,le=20)
 qr_size:float=Field(default=10,ge=6,le=20)
 qr_ecc:Literal['L','M','Q','H']='H'
 offset_x:float=Field(default=1,ge=-10,le=10)
 offset_y:float=Field(default=2,ge=-10,le=10)
 font_family:Literal['simhei','msyh','simsun']='simhei'
 font_weight:Literal['normal','bold']='bold'
 text_size:int=Field(default=20,ge=12,le=24)
 name_size:int=Field(default=20,ge=8,le=32)
 name_han_limit:int=Field(default=3,ge=1,le=10)
 name_char_limit:int=Field(default=5,ge=1,le=20)
def printer():
 config=DATA/'config.json'
 selected=json.loads(config.read_text(encoding='utf-8')).get('printer') if config.exists() else None
 all_printers=win32print.EnumPrinters(2,None,2)
 candidates=[p for p in all_printers if p['pPrinterName']==selected] if selected else [p for p in all_printers if 'pc43t' in p['pPrinterName'].lower()]
 if len(candidates)>1 and not selected:
  preferred=[p for p in candidates if p['pPortName']=='USB002']
  if len(preferred)==1:candidates=preferred
 if len(candidates)!=1:raise RuntimeError('请在本机打印助手中选择已安装的 PC43t（203 dpi）打印机')
 return candidates[0]['pPrinterName']


def update(id,status,detail,spool_id=None):
 with sqlite3.connect(DB) as c:c.execute('UPDATE jobs SET status=?,detail=?,spool_id=COALESCE(?,spool_id) WHERE id=?',(status,detail,spool_id,id))
def getjob(id):
 with sqlite3.connect(DB) as c:
  c.row_factory=sqlite3.Row;r=c.execute('SELECT id,status,detail,spool_id,created FROM jobs WHERE id=?',(id,)).fetchone()
 return dict(r) if r else None
def font_file(j):
 path=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/dict(simhei='simhei.ttf',msyh='msyh.ttc',simsun='simsun.ttc')[j.font_family]
 if not path.is_file():raise ValueError('此电脑未安装所选字体，请选择其它字体')
 return str(path)

def draw_label_text(draw,value,left,top,j):
 # SimHei rendered directly to black/white dots; no gray antialiasing or scaling.
 font=ImageFont.truetype(font_file(j),j.text_size)
 draw.fontmode='1'
 for row in range(2):
  for column,char in enumerate(value[row*6:row*6+6]):
   draw.text((left+column*12+5,top+row*27),char,font=font,fill='black',anchor='mt',stroke_width=int(j.font_weight=='bold'),stroke_fill='black')

def name_layout(value,width,height,j):
 value=' '.join(value.split())
 if not value:raise ValueError('设备名称不能为空')
 def is_han(char):
  return any(lo<=ord(char)<=hi for lo,hi in ((0x3400,0x4DBF),(0x4E00,0x9FFF),(0xF900,0xFAFF),(0x20000,0x323AF)))
 # Mixed names share one line's capacity: Han=1/3, other characters=1/5.
 units=sum(2 if is_han(char) else 1 for char in value)
 if units<=j.name_char_limit:lines=[value]
 else:
  split=min(range(1,len(value)),key=lambda i:(abs(sum(2 if is_han(c) else 1 for c in value[:i])*2-units),-i))
  lines=[value[:split],value[split:]]
 font_path=font_file(j)
 for size in range(j.name_size,7,-1):
  font=ImageFont.truetype(font_path,size);line_height=size+3
  if len(lines)*line_height>height:continue
  widths=[font.getbbox(line,stroke_width=int(j.font_weight=='bold'))[2]-font.getbbox(line,stroke_width=int(j.font_weight=='bold'))[0] for line in lines]
  if max(widths)<=width:return font,lines,line_height
 raise ValueError('设备名称过长，两行无法清晰打印，请缩短名称或增加标签宽度')


def paper_width(j):return j.width*j.columns+j.gap*(j.columns-1)+j.margin_left+j.margin_right
def paper_height(j):return j.height+j.row_gap
def label_origin(j,index):return (j.margin_left+index*(j.width+j.gap),0)

def raster(j,dpi=203):
 px=lambda mm:round(mm*dpi/25.4)
 total=paper_width(j)
 im=Image.new('RGB',(px(total),px(paper_height(j))),'white');draw=ImageDraw.Draw(im)
 for col,value in [(0,j.sn),(2,j.mac)]:
  if col>=j.columns:continue
  qr=qrcode.QRCode(version=None,error_correction=getattr(qrcode.constants,'ERROR_CORRECT_'+j.qr_ecc),box_size=1,border=4);qr.add_data(value);qr.make(fit=True)
  ox,oy=label_origin(j,col)
  matrix=qr.get_matrix();n=len(matrix);size=px(j.qr_size);x=px(ox+(j.width-j.qr_size)/2);y=px(oy+(j.height-j.qr_size)/2)
  # Round every module boundary to printer pixels, preserving a 10mm bounding square rounded to printer pixels.
  for yy,row in enumerate(matrix):
   for xx,dark in enumerate(row):
    if dark:draw.rectangle((x+round(xx*size/n),y+round(yy*size/n),x+round((xx+1)*size/n)-1,y+round((yy+1)*size/n)-1),fill='black')
  if col+1>=j.columns:continue
  ox,oy=label_origin(j,col+1)
  left=px(ox+j.width/2)-35;top=px(oy+j.height/2)-24
  draw_label_text(draw,value,left,top,j)
 if j.columns>=5:
  font,lines,line_height=name_layout(j.device_name,px(j.width-1),px(j.height-1),j)
  ox,oy=label_origin(j,4)
  center=px(ox+j.width/2)
  top=px(oy+j.height/2)-len(lines)*line_height//2
  for i,line in enumerate(lines):draw.text((center,top+i*line_height),line,font=font,fill='black',anchor='mt',stroke_width=int(j.font_weight=='bold'),stroke_fill='black')
 # Whole-row calibration: keep paper size and label pitch unchanged.
 shifted=Image.new('RGB',im.size,'white')
 from PIL import ImageChops
 box=ImageChops.invert(im).getbbox()
 dx,dy=px(j.offset_x),px(j.offset_y)
 if box and (box[0]+dx<0 or box[1]+dy<0 or box[2]+dx>im.width or box[3]+dy>im.height):raise ValueError('打印偏移会裁切内容，请减小偏移或调整纸张尺寸')
 shifted.paste(im,(dx,dy))
 return shifted
def context(j):
 name=printer();h=win32print.OpenPrinter(name)
 try:
  info=win32print.GetPrinter(h,2)
  if info['Status'] & (2|8|16|64|128|4096):raise RuntimeError('打印机报告故障或离线，状态码 '+str(info['Status']))
  dm=info['pDevMode'];dm.PaperSize=256;dm.PaperWidth=round((paper_width(j))*10);dm.PaperLength=round(paper_height(j)*10);dm.Orientation=1;dm.Copies=1
  dm.Fields|=win32con.DM_PAPERSIZE|win32con.DM_PAPERWIDTH|win32con.DM_PAPERLENGTH|win32con.DM_ORIENTATION|win32con.DM_COPIES
  result=win32print.DocumentProperties(0,h,name,dm,dm,win32con.DM_IN_BUFFER|win32con.DM_OUT_BUFFER)
  if result<0:raise RuntimeError('驱动拒绝纸张参数')
  hdc=win32gui.CreateDC('WINSPOOL',name,dm);dc=win32ui.CreateDCFromHandle(hdc)
  caps={str(k):dc.GetDeviceCaps(k) for k in [8,10,88,90,110,111,112,113]}
  expected=(round((paper_width(j))*caps['88']/25.4),round(paper_height(j)*caps['90']/25.4))
  if abs(caps['110']-expected[0])>2 or abs(caps['111']-expected[1])>2:
   dc.DeleteDC();raise RuntimeError('驱动未采用请求尺寸：'+str(caps)+' expected '+str(expected))
  return name,dc,caps
 finally:win32print.ClosePrinter(h)
def run(j):
 id=str(j.id);dc=None;started=False
 try:
  update(id,'printing','正在生成并提交标签');name,dc,caps=context(j)
  if caps['88']!=203 or caps['90']!=203:raise RuntimeError('打印机分辨率不是203dpi')
  im=raster(j);im.save(DATA/(id+'.png'))
  class DOCINFO(ctypes.Structure):
   _fields_=[('cbSize',ctypes.c_int),('lpszDocName',wintypes.LPCWSTR),('lpszOutput',wintypes.LPCWSTR),('lpszDatatype',wintypes.LPCWSTR),('fwType',wintypes.DWORD)]
  startdoc=ctypes.windll.gdi32.StartDocW;startdoc.argtypes=[wintypes.HDC,ctypes.POINTER(DOCINFO)];startdoc.restype=ctypes.c_int
  doc=DOCINFO(ctypes.sizeof(DOCINFO),'FindMy '+j.sn+' '+id[:8],None,None,0)
  jobid=startdoc(dc.GetHandleOutput(),ctypes.byref(doc))
  if jobid<=0:raise RuntimeError('StartDoc 失败，未创建打印任务')
  started=True
  update(id,'submitted','已提交USB驱动，等待队列状态',jobid)
  # Retain this job if supported, to inspect spool completion without changing printer defaults.
  h=win32print.OpenPrinter(name)
  try:
   try:win32print.SetJob(h,jobid,0,None,8)
   except Exception:pass
  finally:win32print.ClosePrinter(h)
  dc.StartPage();ImageWin.Dib(im).draw(dc.GetHandleOutput(),(-caps['112'],-caps['113'],im.width-caps['112'],im.height-caps['113']));dc.EndPage();dc.EndDoc();started=False
  dc.DeleteDC();dc=None
  deadline=time.monotonic()+45;seen=False
  while time.monotonic()<deadline:
   h=win32print.OpenPrinter(name)
   try:
    try:info=win32print.GetJob(h,jobid,1);seen=True
    except Exception as e:
     if getattr(e,'winerror',e.args[0] if e.args else 0) not in (87,2):raise
     update(id,'dispatched','任务已离开系统队列；未取得实际出纸回执，请核对实物');return
   finally:win32print.ClosePrinter(h)
   status=info['Status']
   if status & (2|32|64|512|1024):update(id,'attention','打印队列报告异常：'+str(status)+'；请检查缺纸、开盖或连接');return
   if status & (128|4096):
    update(id,'spool_complete','驱动报告任务完成；不代表二维码可读或实际出纸已核验')
    h=win32print.OpenPrinter(name)
    try:
     try:win32print.SetJob(h,jobid,0,None,9)
     except Exception:pass
    finally:win32print.ClosePrinter(h)
    return
   time.sleep(.5)
  update(id,'uncertain','45秒内未取得完成状态，禁止自动重发，请核对打印机')
 except Exception as e:
  if started and dc:
   try:dc.AbortDoc()
   except Exception:pass
  update(id,'uncertain' if started else 'error',str(e))
 finally:
  if dc:
   try:dc.DeleteDC()
   except Exception:pass
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
@app.middleware('http')
async def local_access(request:Request,call_next):
 origin=request.headers.get('origin');host=request.headers.get('host','')
 logging.info('bridge request method=%s path=%s origin=%s host=%s',request.method,request.url.path,origin,host)
 if host not in {'127.0.0.1:18765','localhost:18765'}:return JSONResponse({'detail':'Invalid host'},403)
 if origin not in ORIGINS and not (not origin and request.method=='GET'):return JSONResponse({'detail':'Origin not allowed'},403)
 if request.method=='OPTIONS':response=Response(status_code=204)
 else:response=await call_next(request)
 if origin in ORIGINS:
  response.headers.update({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Private-Network':'true','Vary':'Origin'})
 return response
@app.get('/health')
def health():
 try:return {'ok':True,'printer':printer(),'physical_ack':False,'layout_version':4,'name_counting':'han2','font_options':True,'paper_options':True,'overflow':'omit','text_rendering':'simhei-bold-mono-v2','qr_mm':10,'qr_ecc':'H','offset_mm':{'x':1,'y':2}}
 except Exception as e:return {'ok':False,'detail':str(e)}
@app.get('/jobs/{id}')
def status(id:uuid.UUID):
 r=getjob(str(id))
 if not r:raise HTTPException(404,'任务不存在')
 return r
@app.post('/jobs')
def submit(j:Job):
 id=str(j.id);payload=j.model_dump_json()
 if paper_width(j)>104:raise HTTPException(400,'总打印宽度超过104mm')
 if j.qr_size>min(j.width,j.height):raise HTTPException(400,'二维码尺寸不能超过单张标签宽高')
 try:raster(j)
 except ValueError as e:raise HTTPException(400,str(e))
 with lock:
  with sqlite3.connect(DB) as c:
   old=c.execute('SELECT payload FROM jobs WHERE id=?',(id,)).fetchone()
   if old:
    if json.loads(old[0])!=json.loads(payload):raise HTTPException(409,'任务ID已用于其他内容')
    return getjob(id)
   c.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?)',(id,payload,'queued','等待打印',None,time.time()))
  pool.submit(run,j)
 return getjob(id)
def main():
 import uvicorn,logging,win32event,win32api
 mutex=win32event.CreateMutex(None,False,'Local\\FindMyPC43tBridge18765')
 if win32api.GetLastError()==183:raise SystemExit(0)
 with sqlite3.connect(DB) as c:c.execute("UPDATE jobs SET status='uncertain',detail='服务重启，之前的任务不自动重发，请核对实物' WHERE status IN ('queued','printing','submitted')")
 logging.basicConfig(filename=str(DATA/'service.log'),level=logging.INFO,format='%(asctime)s %(message)s')
 uvicorn.run(app,host='127.0.0.1',port=18765,access_log=False,log_config=None)

if __name__=='__main__':main()
