"""Capture only the explicitly identified isolated acceptance window, including its native caption."""
import argparse,ctypes,json,os,sys
from pathlib import Path
from ctypes import wintypes
from PIL import Image
parser=argparse.ArgumentParser();parser.add_argument('--hwnd',type=int,required=True);parser.add_argument('--pid',type=int,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
user=ctypes.WinDLL('user32',use_last_error=True)
try:
 user.SetProcessDpiAwarenessContext.argtypes=[ctypes.c_void_p];user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except AttributeError:user.SetProcessDPIAware()
gdi=ctypes.WinDLL('gdi32',use_last_error=True)
user.GetWindowDC.restype=wintypes.HDC;user.GetWindowDC.argtypes=[wintypes.HWND]
gdi.CreateCompatibleDC.restype=wintypes.HDC;gdi.CreateCompatibleDC.argtypes=[wintypes.HDC]
gdi.CreateCompatibleBitmap.restype=wintypes.HBITMAP;gdi.CreateCompatibleBitmap.argtypes=[wintypes.HDC,ctypes.c_int,ctypes.c_int]
gdi.SelectObject.restype=wintypes.HGDIOBJ;gdi.SelectObject.argtypes=[wintypes.HDC,wintypes.HGDIOBJ]
gdi.GetDIBits.argtypes=[wintypes.HDC,wintypes.HBITMAP,wintypes.UINT,wintypes.UINT,ctypes.c_void_p,ctypes.c_void_p,wintypes.UINT]
user.PrintWindow.argtypes=[wintypes.HWND,wintypes.HDC,wintypes.UINT]
gdi.DeleteObject.argtypes=[wintypes.HGDIOBJ];gdi.DeleteDC.argtypes=[wintypes.HDC];user.ReleaseDC.argtypes=[wintypes.HWND,wintypes.HDC]
user.GetWindowThreadProcessId.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]
hwnd=wintypes.HWND(args.hwnd);pid=wintypes.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
title=ctypes.create_unicode_buffer(256);user.GetWindowTextW(hwnd,title,256)
if pid.value!=args.pid or title.value!='Somnus theme fixture':raise RuntimeError('Capture rejected: not the isolated fixture window')
output=args.output.resolve();project_root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(project_root));from storage_paths import cache_path
expected=cache_path('tmp','appearance-electron-fixture',project_root=project_root)
if output.parent!=expected.resolve() or output.suffix!='.png':raise RuntimeError('Capture target rejected')
rect=wintypes.RECT();user.GetWindowRect(hwnd,ctypes.byref(rect));width=rect.right-rect.left;height=rect.bottom-rect.top
if not 100<=width<=4000 or not 100<=height<=3000:raise RuntimeError('Invalid fixture window bounds')
# DWM caption controls are not included by PrintWindow. Capture only this verified topmost window rectangle.
user.GetDC.restype=wintypes.HDC;user.GetDC.argtypes=[wintypes.HWND]
user.WindowFromPoint.restype=wintypes.HWND;user.WindowFromPoint.argtypes=[wintypes.POINT]
user.GetAncestor.restype=wintypes.HWND;user.GetAncestor.argtypes=[wintypes.HWND,wintypes.UINT]
for x,y in ((rect.left+25,rect.top+25),(rect.right-25,rect.top+25),(rect.left+width//2,rect.top+height//2),(rect.left+25,rect.bottom-25)):
 owner=user.GetAncestor(user.WindowFromPoint(wintypes.POINT(x,y)),2)
 if owner!=args.hwnd:raise RuntimeError('Capture refused: fixture window is occluded')
gdi.BitBlt.argtypes=[wintypes.HDC,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,wintypes.HDC,ctypes.c_int,ctypes.c_int,wintypes.DWORD]
hdc=user.GetDC(None);memory=gdi.CreateCompatibleDC(hdc);bitmap=gdi.CreateCompatibleBitmap(hdc,width,height);old=gdi.SelectObject(memory,bitmap)
class InfoHeader(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('width',wintypes.LONG),('height',wintypes.LONG),('planes',wintypes.WORD),('bit_count',wintypes.WORD),('compression',wintypes.DWORD),('image_size',wintypes.DWORD),('xppm',wintypes.LONG),('yppm',wintypes.LONG),('used',wintypes.DWORD),('important',wintypes.DWORD)]
try:
 if not gdi.BitBlt(memory,0,0,width,height,hdc,rect.left,rect.top,0x00CC0020):raise RuntimeError('Native window rectangle capture failed')
 header=InfoHeader(ctypes.sizeof(InfoHeader),width,-height,1,32,0,0,0,0,0,0);buffer=ctypes.create_string_buffer(width*height*4)
 if not gdi.GetDIBits(memory,bitmap,0,height,buffer,ctypes.byref(header),0):raise RuntimeError('Native bitmap read failed')
 Image.frombuffer('RGB',(width,height),buffer.raw,'raw','BGRX',0,1).save(output)
 print(json.dumps(dict(captured=True,width=width,height=height,native_caption=True)))
finally:
 gdi.SelectObject(memory,old);gdi.DeleteObject(bitmap);gdi.DeleteDC(memory);user.ReleaseDC(None,hdc)
