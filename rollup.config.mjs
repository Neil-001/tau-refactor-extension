import commonjs from "@rollup/plugin-commonjs"
import { nodeResolve } from "@rollup/plugin-node-resolve"
import typescript from "@rollup/plugin-typescript"

export default [
  {
    input: "src/background.ts",
    output: {
      file: "dist/background.js",
      format: "cjs",
    },
    plugins: [commonjs(), typescript(), nodeResolve()],
  },
  {
    input: "src/ims.ts",
    output: {
      file: "dist/ims.js",
      format: "cjs",
    },
    plugins: [commonjs(), typescript(), nodeResolve()],
  },
  {
    input: "src/mytau.ts",
    output: {
      file: "dist/mytau.js",
      format: "cjs",
    },
    plugins: [commonjs(), typescript(), nodeResolve()],
  },
]
