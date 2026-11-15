"""Build a self-contained Windows ZIP; explicit source/assets, no user data."""
from pathlib import Path
import os
import subprocess
import sys
import shutil
import hashlib
import importlib.metadata
from app_version import APP_VERSION

ROOT=Path(__file__).resolve().parent
def main():
    if sys.platform!='win32':raise SystemExit('Build this bundle on Windows.')
    web=ROOT/'page_design'/'web'
    if not (web/'index.html').is_file():
        raise SystemExit('Build the workbench first: cd page_design/frontend; pnpm install; pnpm build')
    env=os.environ.copy()
    env['PYINSTALLER_CONFIG_DIR']=str(ROOT/'build'/'pyinstaller-cache')
    if (ROOT/'.build-deps').exists():env['PYTHONPATH']=str(ROOT/'.build-deps')
    command=[sys.executable,'-m','PyInstaller','--noconfirm','--onedir','--noconsole','--name','Somnus',
             '--distpath',str(ROOT/'dist'),'--workpath',str(ROOT/'build'),
             '--specpath',str(ROOT/'build'),'--exclude-module','matplotlib','--exclude-module','scipy',
             '--exclude-module','IPython','--exclude-module','pytest','--exclude-module','torch',
             '--exclude-module','tkinter']
    try:
        import webview  # noqa: F401
        command+=['--collect-submodules','webview','--hidden-import','webview.platforms.edgechromium',
                  '--hidden-import','clr_loader','--hidden-import','pythonnet']
    except Exception:
        print('pywebview 未安装：打包后的程序将在默认浏览器中打开界面。')
    for folder,names in (('event_detection',('index.html','viewer.js','annotation-model.js')),
                         ('page_design',('dashboard.html','dashboard.js','dashboard.css','events.css','vendor/bootstrap.min.css','vendor/bootstrap.LICENSE'))):
        for name in names:
            destination=Path(folder)/Path(name).parent
            command+=['--add-data',f'{ROOT/folder/name}:{destination}']
    for asset in sorted(web.rglob('*')):
        if asset.is_file():
            command+=['--add-data',f'{asset}:{Path("page_design/web")/asset.relative_to(web).parent}']
    command+=['--add-data',str(ROOT/'mcp.json')+':.']
    mcp_dir=ROOT/'mcp'
    for item in sorted(mcp_dir.rglob('*.py')):
        command+=['--add-data',f"{item}:mcp/{item.parent.relative_to(mcp_dir).as_posix()}"]
    plugin_root=ROOT/'plugins'
    if plugin_root.is_dir():
        for item in sorted(plugin_root.rglob('*')):
            if item.is_file() and '__pycache__' not in item.parts:
                command+=['--add-data',f'{item}:plugins/{item.relative_to(plugin_root).parent.as_posix()}']
    subprocess.run(command+[str(ROOT/'launcher.py')],cwd=ROOT,env=env,check=True)
    bundle=ROOT/'dist'/'Somnus'
    shutil.copyfile(ROOT/'USER_GUIDE.md',bundle/'使用说明.txt')
    licenses=bundle/'THIRD_PARTY_LICENSES';licenses.mkdir(exist_ok=True)
    for package in ('react','react-dom','antd','@ant-design/icons','echarts','zrender'):
        source=ROOT/'page_design'/'frontend'/'node_modules'/package
        for name in ('LICENSE','LICENSE.txt','NOTICE'):
            if (source/name).is_file():
                target=licenses/'frontend'/package
                target.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(source/name,target/name)
    distributions={d.metadata['Name'].lower():d for d in importlib.metadata.distributions(path=[str(ROOT/'.build-deps'),*sys.path]) if d.metadata.get('Name')}
    for name in ('numpy','pandas','python-dateutil','six','tzdata','pyinstaller'):
        distribution=distributions.get(name)
        if distribution is None:continue
        for entry in distribution.files or []:
            if any(word in entry.name.lower() for word in ('license','copying','notice')):
                source=distribution.locate_file(entry)
                if not source.is_file():continue
                parts=entry.parts
                relative=Path(*parts[1:]) if len(parts)>1 else Path(entry.name)
                destination=licenses/name/relative
                destination.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(source,destination)
    for name in ('LICENSE.txt','LICENSE'):
        source=Path(sys.base_prefix)/name
        if source.is_file():shutil.copyfile(source,licenses/('Python-'+name))
    output=ROOT/'release';output.mkdir(exist_ok=True)
    path=Path(shutil.make_archive(str(output/f'Somnus-{APP_VERSION}-windows-x64'),'zip',ROOT/'dist','Somnus'))
    (output/(path.name+'.sha256')).write_text(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+path.name+'\n',encoding='ascii')
    print(path)
if __name__=='__main__':main()
