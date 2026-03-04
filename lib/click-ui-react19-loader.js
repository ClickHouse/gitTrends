// Custom webpack loader that patches @clickhouse/click-ui's bundled code
// for React 19 compatibility.
module.exports = function (source) {
  return source
    // 1. __SECRET_INTERNALS removed in React 19 — safe access
    .replace(
      /(\w+)\.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED(?!\s*=)/g,
      '($1.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED||{})'
    )
    // 2. forwardRef callbacks must have exactly 0 or 2 params in React 19.
    //    Patch single-param forms to add a second `_ref` param.
    .replace(/\.forwardRef\(function\((\w+)\)\{/g, '.forwardRef(function($1,_ref){')
    .replace(/\.forwardRef\(\((\w+)\)=>/g,        '.forwardRef(($1,_ref)=>')
    .replace(/\.forwardRef\((\w+)=>/g,            '.forwardRef(($1,_ref)=>')
    // 3. element.ref was removed in React 19 — use element.props.ref instead.
    .replace(/(\w+)\.ref(?=\b)(?!\s*=)(?!\s*!)/g, '($1.props&&"ref"in $1.props?$1.props.ref:$1.ref)')
}
