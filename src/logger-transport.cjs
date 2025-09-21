const rotatingFileStreamFactory = require('pino-rotating-file-stream');
const factory = typeof rotatingFileStreamFactory === 'function'
  ? rotatingFileStreamFactory
  : rotatingFileStreamFactory.default;

module.exports = function loggerTransport(options) {
  const sanitized = options && typeof options === 'object'
    ? { ...options }
    : {};

  if (Object.prototype.hasOwnProperty.call(sanitized, '$context')) {
    delete sanitized.$context;
  }

  if (Object.prototype.hasOwnProperty.call(sanitized, 'pinoWillSendConfig')) {
    delete sanitized.pinoWillSendConfig;
  }

  return factory(sanitized);
};
