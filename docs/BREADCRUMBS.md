# Breadcrumbs

Operational notes for future agents working on this codebase.

## Memory/Embeddings Testing

When using `generateEmbedding(dimensions, seed)` test helper:
- Seeds 1 and 2 produce embeddings with ~0.85 cosine similarity
- Seeds 1 and 10 produce embeddings with ~0.36 cosine similarity
- Don't assume "similar" seeds will have >0.9 similarity; use thresholds appropriate for actual values

## Test Running

- Tests use Node.js built-in test runner: `npm test` or `node --test`
- All tests in `/test/**/*.test.js` pattern are discovered automatically
