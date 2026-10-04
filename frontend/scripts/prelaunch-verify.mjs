// 演练流程验证的启动器：用 esbuild 把 scripts/prelaunch-verify.ts 连同 src/ 源码打包后在 node 里跑。
// 用法：npm run verify:prelaunch
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

const outfile = 'node_modules/.cache/prelaunch-verify.cjs'

await build({
  entryPoints: ['scripts/prelaunch-verify.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { '@': './src' },
  outfile,
  logLevel: 'warning',
})

execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
