"""Copy versioned frontend resources into a server checkout or /opt. Does not restart services."""
import argparse,shutil,os
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--target',required=True,help='Server services/ directory or /opt');a=p.parse_args()
root=Path(__file__).resolve().parents[1]/'assets';target=Path(a.target).resolve()
for service in root.iterdir():
 if not service.is_dir():continue
 for src in service.rglob('*'):
  if src.is_file():
   dest=target/service.name/'static'/src.relative_to(service);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
   if src.name=='baidu_map.html' and os.environ.get('BAIDU_BROWSER_AK'):
    key=os.environ['BAIDU_BROWSER_AK']
    if not key.isalnum():raise ValueError('BAIDU_BROWSER_AK must be alphanumeric')
    dest.write_text(dest.read_text(encoding='utf-8').replace('__BAIDU_BROWSER_AK__',key),encoding='utf-8')
print('Static assets installed in',target)
