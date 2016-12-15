const rc = require('./rc')
const utility = require('./utility')
const Pipeline = require('./pipeline')
const mws = require('./middleware')
const logger = require('./logger')
const globals = require('./globals')
const blueprint = require('./blueprint')
const {parseAsync} = require('./swagger')
const {HttpError, ParameterError} = require('./error')

exports.createApplicationAsync = createApplicationAsync
// backward compability
exports.ResponseError = exports.HttpError = HttpError
exports.ParameterError = ParameterError
exports.translate = exports.utility = utility
exports.parseAsync = parseAsync
exports.logger = logger
exports.rc = rc
exports.wrapRoute = utility.wrapRoute
exports.wrapMiddleware = utility.wrapMiddleware

async function createApplicationAsync (app, options = {}) {
  try {
    const {
      logger: {file, logstash, sentry} = {},
      dynamicDefinition = {},
      errorHandler,
      model
    } = options

    logger.initialize({file, logstash, sentry})
    const {raw, models, services, securitys, middlewares} = await globals.initialize({model})
    const api = await blueprint.initialize(dynamicDefinition, models)

    exports.app = app
    exports.api = api
    exports.raw = raw
    exports.models = models
    exports.services = services
    exports.securitys = securitys
    exports.middlewares = exports.mws = middlewares
    if (rc.env === 'test') {
      exports.test = require('./supertest').initialize(app, api)
    }

    app.use((req, res, next) => {
      req.state = {
        version: api.definition.info.version
      }
      const operation = api.getOperation(req)
      req.swagger = {
        operation: operation
      }
      next()
    })

    //
    // Response pipeline
    //

    const pipeline = Pipeline()
    pipeline.use(mws.debug.postHandler())
    // remove response `null` fields
    pipeline.use(mws.validation.response())
    pipeline.use(mws.debug.response())
    app.use(pipeline.createMiddleware())

    //
    // Request pipeline
    //

    // binding request context
    app.use(mws.context(rc.target + '/context'))
    // setup swagger documentation
    app.use(mws.docs(api.definition))
    app.use(mws.switch())
    // request & response logging
    app.use(mws.debug.request())
    // request validation
    app.use(mws.validation.request())
    // security handler
    app.use(mws.security(api, securitys))
    // dynamic swagger defined route
    app.use(mws.debug.preHandler())
    app.use(mws.api(api))
    // 404
    app.use(() => {
      throw new HttpError('NotFound')
    })
    // error handling
    app.use(mws.errorHandler(api, errorHandler))

    return app
  } catch (err) {
    console.log(err.stack) // eslint-disable-line
    process.exit(1)
  }
}

process.on('unhandledRejection', function (reason, p) {
  let err = new Error('Unhandled Promise rejection')
  err.reason = reason
  err.promise = p
  logger.error('Unhandled Rejection at: Promise ', p, ' reason: ', reason)
  logger.error(reason.message, reason.stack)
  throw err
})
