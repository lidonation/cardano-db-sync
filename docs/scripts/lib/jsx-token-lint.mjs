import ts from 'typescript';
import {RAW_COLOUR, NAMED_COLOUR} from './css-colours.mjs';

const RAW =
  /[-+]?(?:\d*\.)?\d+(?:px|rem|em|ch)\b|#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const COLOUR_PROPERTY = /color|background|fill|stroke|border|shadow/i;
const NUMERIC_STYLE =
  /^(?:padding|margin|gap|rowGap|columnGap|inset|top|right|bottom|left|width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize|strokeWidth|borderWidth|outlineWidth|outlineOffset|inlineSize|blockSize|minInlineSize|maxInlineSize|minBlockSize|maxBlockSize)/;
const SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'use',
  'symbol',
  'image',
  'foreignObject',
  'marker',
  'pattern',
  'mask',
  'filter',
]);
const SVG_PRESENTATION = new Set(['strokeWidth', 'fontSize', 'width', 'height']);

/** Inspect real JSX nodes, never comments or quoted example markup. Dynamic values remain caller-owned. */
export function findJsxTokenProblems(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems = [];
  const add = (node, rule, message) =>
    problems.push({
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
      rule,
      message,
    });
  // The compiler binder preserves lexical scopes, including parameter/destructuring shadows.
  const host = ts.createCompilerHost({noLib: true});
  host.getSourceFile = (name) => (name === file ? ast : undefined);
  const checker = ts.createProgram([file], {noLib: true}, host).getTypeChecker();
  const resolve = (node, seen = new Set()) => {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return resolve(node.expression, seen);
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        !seen.has(declaration)
      ) {
        seen.add(declaration);
        return resolve(declaration.initializer, seen);
      }
    }
    return node;
  };
  const literal = (node) =>
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));
  const inspectObject = (node, seen = new Set()) => {
    if (!ts.isObjectLiteralExpression(node) || seen.has(node)) return;
    seen.add(node);
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) {
        inspectObject(resolve(p.expression), seen);
        continue;
      }
      if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
      const name = p.name.getText(ast).replace(/^['"]|['"]$/g, '');
      const v = ts.isShorthandPropertyAssignment(p)
        ? (() => {
            const declaration = checker.getShorthandAssignmentValueSymbol(p)?.valueDeclaration;
            return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
              ? resolve(declaration.initializer)
              : p.name;
          })()
        : resolve(p.initializer);
      if (!literal(v)) continue;
      const value = (ts.isStringLiteralLike(v) ? v.text : v.getText(ast))
        .replace(/url\([^)]*\)/gi, '')
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
      if (value.startsWith('var(') && !RAW.test(value)) continue;
      if (
        RAW.test(value) ||
        (NUMERIC_STYLE.test(name) && /^-?(?:\d*\.)?\d+$/.test(value) && Number(value) !== 0) ||
        (COLOUR_PROPERTY.test(name) && (RAW_COLOUR.test(value) || NAMED_COLOUR.test(value)))
      ) {
        const colour =
          RAW_COLOUR.test(value) || (COLOUR_PROPERTY.test(name) && NAMED_COLOUR.test(value));
        const layout = /size|width|height/i.test(name);
        const token = colour
          ? /color|fill|stroke/i.test(name)
            ? 'text'
            : 'border'
          : /border|outlineWidth/i.test(name)
            ? 'border-width'
            : layout
              ? 'size'
              : 'space';
        add(
          p,
          colour ? 'TOK-18' : layout ? 'TOK-16' : 'TOK-15',
          `raw inline ${name} - use var(--dbs-${token}-*) or a src/lib token constant`,
        );
      }
    }
  };
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      const native = SVG_TAGS.has(tag);
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const name = a.name.getText(ast);
        const expression = ts.isJsxExpression(a.initializer)
          ? a.initializer.expression
          : a.initializer;
        const v = expression ? resolve(expression) : undefined;
        if (!v) continue;
        if (name === 'style') inspectObject(v);
        if (
          native &&
          SVG_PRESENTATION.has(name) &&
          literal(v) &&
          /^[-+]?(?:\d*\.)?\d+(?:px|rem|em)?$/.test(
            ts.isStringLiteralLike(v) ? v.text : v.getText(ast),
          )
        )
          add(
            a,
            'TOK-16',
            `raw JSX ${name} - use --dbs-icon-* / --dbs-size-* through a src/lib token constant or props`,
          );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return problems;
}
