function isScopeInvalid(error) {
  return error?.scopeInvalid === true || ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code);
}
module.exports = { isScopeInvalid };
