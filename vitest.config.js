// Vitest picks this file over vite.config.js. It reuses that config and widens the
// test glob so server code under api/ (Node, UI-free) is tested too.
// api tests opt out of jsdom with a `// @vitest-environment node` docblock.
import { mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(viteConfig, {
    test: {
        include: ['src/**/*.test.{js,jsx}', 'api/**/*.test.js'],
    },
})
