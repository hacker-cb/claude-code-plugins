#!/usr/bin/env node
// Rasterize an SVG to PNG with @resvg/resvg-js, resolved from the cache dir
// the shell wrapper installs into (DBML_RENDER_CACHE env var).
//
// Usage: node svg-to-png.mjs <in.svg> <out.png> [width-px]
//
// A width of 0 keeps the SVG's natural size; otherwise the output is scaled
// to the given pixel width (the source is vector, so upscaling stays crisp).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [svgPath, pngPath, widthArg] = process.argv.slice(2)
if (!svgPath || !pngPath) {
  console.error('usage: svg-to-png.mjs <in.svg> <out.png> [width-px]')
  process.exit(2)
}

const cache = process.env.DBML_RENDER_CACHE
const requireFromCache = createRequire(cache ? join(cache, 'package.json') : import.meta.url)
const { Resvg } = requireFromCache('@resvg/resvg-js')

const svg = readFileSync(svgPath, 'utf8')
const opts = {
  font: { loadSystemFonts: true },
  // Solid background: the SVG is transparent, which is unreadable on dark
  // chat themes once rasterized.
  background: 'white',
}
const width = Number(widthArg) || 0
if (width > 0) opts.fitTo = { mode: 'width', value: width }

const png = new Resvg(svg, opts).render().asPng()
writeFileSync(pngPath, png)
