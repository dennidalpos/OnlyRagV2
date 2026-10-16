'use strict';

const MAX_DEPTH = 64;
const MAX_NODES = 131072;

const assertDepth = depth => {
  if (depth > MAX_DEPTH) {
    const error = new SyntaxError('Brace AST exceeds maximum nesting depth of 64');
    error.code = 'ERR_BRACES_DEPTH';
    throw error;
  }
};

// Validate before entering any recursive walker, including caller-supplied ASTs.
// Parent/prev links are deliberately excluded: parsed trees contain back-references.
const assertAstDepth = ast => {
  const pending = [{ node: ast, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop();
    assertDepth(depth);
    if (++count > MAX_NODES) {
      throw new SyntaxError('Brace AST exceeds maximum node count');
    }
    if (node && Array.isArray(node.nodes)) {
      if (node.nodes.length > MAX_NODES - count || pending.length + node.nodes.length > MAX_NODES) {
        throw new SyntaxError('Brace AST exceeds maximum node count');
      }
      for (const child of node.nodes) pending.push({ node: child, depth: depth + 1 });
    }
  }
};

module.exports = { assertDepth, assertAstDepth };
