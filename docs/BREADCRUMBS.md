Session Management Migration - Blocking Issue Discovered

**Issue**: ESM-only package compatibility with CommonJS project

The `@mariozechner/pi-coding-agent` package (added in Step A.1) is ESM-only (has `"type": "module"` in its package.json), while Jevons is a CommonJS project (`"type": "commonjs"`). This means standard `require()` calls fail with:

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in .../pi-coding-agent/package.json
```

**Resolution**: Migrated entire codebase to ESM in Step A.1.1

**Migration Summary**:
- Changed `package.json` `"type"` from `"commonjs"` to `"module"`
- Converted all `require()` statements to `import`
- Converted all `module.exports` to `export` or `export default`
- Replaced `__dirname` with `import.meta.dirname` (or `fileURLToPath(import.meta.url)` pattern)
- Replaced `require.main === module` with `import.meta.url === 'file://' + process.argv[1]`

**Example conversions**:
```javascript
// Before (CommonJS):
const fs = require('fs');
const { helper } = require('./utils');
module.exports = { func };

// After (ESM):
import fs from 'fs';
import { helper } from './utils.js';  // Note: .js extension required
export { func };
```

**Important notes**:
- ESM requires explicit file extensions in imports (e.g., `./config.js` not `./config`)
- Dynamic imports return a module namespace object; use `const module = await import('pkg'); const { name } = module;`
- 150/154 tests passing after migration (4 pre-existing async timing issues unrelated to ESM)
