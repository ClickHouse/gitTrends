// Custom webpack loader that patches @clickhouse/click-ui's bundled code
// to safely access React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
// which was removed in React 19 (the key doesn't exist, so it's undefined).
module.exports = function (source) {
  // Replace: e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  // With:    (e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED||{})
  return source.replace(
    /(\w+)\.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED(?!\s*=)/g,
    '($1.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED||{})'
  )
}
