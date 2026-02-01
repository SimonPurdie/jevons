Session Management Migration - Blocking Issue Discovered

**Issue**: ESM-only package compatibility with CommonJS project

The `@mariozechner/pi-coding-agent` package (added in Step A.1) is ESM-only (has `"type": "module"` in its package.json), while Jevons is a CommonJS project (`"type": "commonjs"`). This means standard `require()` calls fail with:

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in .../pi-coding-agent/package.json
```

**Resolution**: Use dynamic `import()` statements in CommonJS code to load ESM modules.

Example:
```javascript
// Instead of: const { SessionManager } = require('@mariozechner/pi-coding-agent');
// Use: 
const { SessionManager } = await import('@mariozechner/pi-coding-agent');
```

Note: This requires the importing code to be async (either in an async function or using top-level await if supported by the Node.js version).

**Impact on migration**:
- All imports from `pi-coding-agent` must use dynamic imports
- Test files need to be restructured to support async module loading
- The integration test for Step A.1 should verify dynamic import works correctly
