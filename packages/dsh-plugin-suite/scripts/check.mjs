import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
for (const f of ['package.json', 'locale/zh.json', 'locale/en.json']) {
  const j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
  console.log('ok', f, '->', j.meta ? j.meta.title : j.name)
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
console.log('exports:', Object.keys(pkg.exports).join(', '))
console.log('files:', pkg.files.join(', '))
console.log('dsh.client:', JSON.stringify(pkg.dsh.client))
console.log('icon bytes:', fs.statSync(path.join(root, 'icon.svg')).size)
console.log('client.js bytes:', fs.statSync(path.join(root, 'client.js')).size)
console.log('index.js bytes:', fs.statSync(path.join(root, 'index.js')).size)
