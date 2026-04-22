import { compile } from "@tsrx/react";
import { transformWithEsbuild, type Plugin } from "vite";

const tsrxExtensionPattern = /\.tsrx$/;
const cssQuery = "?tsrx-css&lang.css";

export function tsrxReact(): Plugin {
  const cssCache = new Map<string, string>();

  return {
    name: "tsrx-react-compat",
    enforce: "pre",

    resolveId(source) {
      if (!source.includes(cssQuery)) {
        return null;
      }

      if (source.startsWith("\0")) {
        return source;
      }

      return `\0${source}`;
    },

    load(id) {
      if (!id.startsWith("\0") || !id.includes(cssQuery)) {
        return null;
      }

      const key = id.slice(1).split("?")[0]!;
      return cssCache.get(key) ?? "";
    },

    async transform(code, id) {
      if (!tsrxExtensionPattern.test(id)) {
        return null;
      }

      const { code: tsxCode, css } = compile(code, id);

      let source = tsxCode;
      if (css) {
        cssCache.set(id, css.code);
        source = `import ${JSON.stringify(id + cssQuery)};\n${tsxCode}`;
      } else {
        cssCache.delete(id);
      }

      const result = await transformWithEsbuild(source, id, {
        loader: "tsx",
        sourcemap: true,
        jsx: "automatic",
        jsxImportSource: "react",
        target: "esnext",
      });

      return {
        code: result.code,
        map: result.map,
      };
    },
  };
}
