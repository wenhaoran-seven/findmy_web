"""Windows desktop launcher; service uses a separate hidden child process."""
import sys,os,json,subprocess,urllib.request,webbrowser
from pathlib import Path
URL=os.environ.get('FINDMY_WEB_URL','https://192.168.168.162/')
DATA=Path(os.environ.get('FINDMY_PRINTER_DATA') or str(Path(os.environ['LOCALAPPDATA'])/'FindMyPrint'))
os.environ['FINDMY_PRINTER_DATA']=str(DATA)
DATA.mkdir(parents=True,exist_ok=True)
if '--serve' in sys.argv:
 import service
 service.main()
 raise SystemExit
if '--self-test' in sys.argv:
 import service,uuid
 result={}
 try:
  j=service.Job(id=uuid.uuid4(),sn='123456789012',mac='CCBBDDEEFFAA',device_name='设备名称测试')
  im=service.raster(j);im.save(DATA/'self-test.png')
  assert im.size==(480,96)
  assert len(service.name_layout('ABCDEFG',72,72,j)[1])==2
  import uvicorn
  result={'ok':True,'size':list(im.size),'layout_version':4,'prints_submitted':0}
 except Exception as e:result={'ok':False,'error':str(e)}
 (DATA/'self-test.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
 raise SystemExit(0 if result['ok'] else 1)
import tkinter as tk
from tkinter import ttk,messagebox
import win32print
root=tk.Tk();root.title('FindMy 本机打印助手');root.geometry('650x330');root.resizable(False,False)
status=tk.StringVar(value='正在检查本机服务…')
selected=tk.StringVar()
frame=ttk.Frame(root,padding=20);frame.pack(fill='both',expand=True)
ttk.Label(frame,text='FindMy 烧录与打印',font=('Microsoft YaHei',16,'bold')).pack(anchor='w')
ttk.Label(frame,text='串口由 Chrome / Edge 网页直接连接；本助手负责 USB 标签打印。').pack(anchor='w',pady=8)
ttk.Label(frame,text='打印机（请先安装 PC43t 203 dpi 驱动）：').pack(anchor='w')
combo=ttk.Combobox(frame,textvariable=selected,state='readonly',width=76);combo.pack(fill='x',pady=8)
def printers():
 values=[p['pPrinterName'] for p in win32print.EnumPrinters(2,None,2) if 'pc43t' in p['pPrinterName'].lower()]
 combo['values']=values
 config=DATA/'config.json'
 saved=json.loads(config.read_text(encoding='utf-8')).get('printer') if config.exists() else ''
 if saved in values:selected.set(saved)
 elif len(values)==1:selected.set(values[0])
def save():
 if not selected.get():messagebox.showwarning('选择打印机','请先安装驱动并选择 PC43t 打印机');return
 (DATA/'config.json').write_text(json.dumps({'printer':selected.get()},ensure_ascii=False),encoding='utf-8')
 check()
def health():
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 with op.open('http://127.0.0.1:18765/health',timeout=2) as r:return json.load(r)
def check():
 try:
  h=health()
  if h.get('layout_version')!=4:status.set('检测到旧版服务：请先退出旧服务，再点击启动服务。')
  else:status.set('服务已运行：'+h['printer'] if h.get('ok') else h.get('detail','打印机未就绪'))
 except Exception:status.set('本机服务未启动，点击“启动服务”。')
def start():
 try:health();check();return
 except Exception:pass
 cmd=[sys.executable,'--serve'] if getattr(sys,'frozen',False) else [sys.executable,str(Path(__file__).resolve()),'--serve']
 subprocess.Popen(cmd,creationflags=subprocess.CREATE_NO_WINDOW,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 status.set('正在启动…');root.after(1500,check)
buttons=ttk.Frame(frame);buttons.pack(fill='x',pady=6)
for label,fn in [('刷新打印机',printers),('保存选择',save),('启动服务',start),('检查状态',check),('打开网页',lambda:webbrowser.open(URL+'#print'))]:ttk.Button(buttons,text=label,command=fn).pack(side='left',padx=3)
ttk.Label(frame,textvariable=status,wraplength=600).pack(anchor='w',pady=12)
ttk.Label(frame,text='网页参数自动保存，下次打印生效。关闭本窗口不会停止后台打印服务。',wraplength=600).pack(anchor='w')
printers();start();root.mainloop()
