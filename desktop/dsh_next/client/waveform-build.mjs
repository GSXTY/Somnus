import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replaceExact } from '../overlay.mjs';

/** Adapt the existing canvas workspace into an explicitly mounted module. */
export const waveformBuildPlugin = {
  name: 'somnus-waveform-module',
  setup(build) {
    build.onResolve({ filter: /\?somnus-native$/ }, args => ({
      path: resolve(args.resolveDir, args.path.replace(/\?somnus-native$/, '')), namespace: 'somnus-waveform',
    }));
    build.onLoad({ filter: /.*/, namespace: 'somnus-waveform' }, ({ path }) => {
      let source = readFileSync(path, 'utf8');
      if (path.endsWith('viewer.js')) {
        source = replaceExact(source, 'function render(){if(!meta)return;',
          'function render(){if(!meta||document.hidden)return;', path);
        source = replaceExact(source, 'function drawOverview(){if(!meta)return;',
          "function drawOverview(){if(!meta||document.hidden||!$('overview').clientWidth)return;", path);
        return { loader: 'js', contents:
          `export default function mount(document,window,fetch,AnnotationModel,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,setInterval,clearInterval,URL){\n${source}\nreturn ()=>{rememberFileView();controller?.abort();serial++;generation++;};\n}` };
      }
      if (path.endsWith('annotation-model.js')) return { loader: 'js', contents:
        `const globalThis={};const module={exports:{}};\n${source}\nexport default module.exports;` };
      return { loader: 'js', contents: `export default ${JSON.stringify(source)};` };
    });
  },
};
