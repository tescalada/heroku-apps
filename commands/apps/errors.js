'use strict'

const co = require('co')
const cli = require('heroku-cli-util')

let colorize = (level, s) => {
  switch (level) {
    case 'critical':
      return cli.color.red(s)
    case 'warning':
      return cli.color.yellow(s)
    case 'info':
      return cli.color.cyan(s)
    default:
      return s
  }
}

function buildErrorTable (errors, source) {
  const errorInfo = require('../../lib/error_info.json')

  return Object.keys(errors).map((name) => {
    let count = errors[name]
    let info = errorInfo.find((e) => e.name === name)
    return {name, count, source, level: info.level, title: info.title}
  })
}

function * run (context, heroku) {
  const sum = require('lodash.sum')
  const fromPairs = require('lodash.frompairs')

  const hours = parseInt(context.flags.hours) || 24
  const NOW = new Date().toISOString()
  const YESTERDAY = new Date(new Date().getTime() - (hours * 60 * 60 * 1000)).toISOString()
  const DATE = `start_time=${YESTERDAY}&end_time=${NOW}&step=1h`

  function routerErrors () {
    return heroku.request({
      host: 'api.metrics.herokai.com',
      path: `/apps/${context.app}/router-metrics/errors?${DATE}&process_type=web`,
      headers: {Range: ''}
    }).then((rsp) => {
      Object.keys(rsp.data).forEach((key) => { rsp.data[key] = sum(rsp.data[key]) })
      return rsp.data
    })
  }

  function dynoErrors (type) {
    return heroku.request({
      host: 'api.metrics.herokai.com',
      path: `/apps/${context.app}/formation/${type}/metrics/errors?${DATE}`,
      headers: {Range: ''}
    }).then((rsp) => {
      Object.keys(rsp.data).forEach((key) => { rsp.data[key] = sum(rsp.data[key]) })
      return rsp.data
    })
  }

  let formation = yield heroku.get(`/apps/${context.app}/formation`)
  let types = formation.map((p) => p.type)
  let showDyno = context.flags.dyno || !context.flags.router
  let showRouter = context.flags.router || !context.flags.dyno
  let errors = yield {
    dyno: showDyno ? fromPairs(types.map((type) => [type, dynoErrors(type)])) : {},
    router: showRouter ? routerErrors() : {}
  }

  if (context.flags.json) {
    cli.styledJSON(errors)
  } else {
    let t = buildErrorTable(errors.router, 'router')
    for (let type of Object.keys(errors.dyno)) t = t.concat(buildErrorTable(errors.dyno[type]))
    if (t.length === 0) {
      cli.log(`No errors on ${cli.color.app(context.app)} in the last ${hours} hours`)
    } else {
      cli.styledHeader(`Errors on ${cli.color.app(context.app)} in the last ${hours} hours`)
      cli.table(t, {
        columns: [
          {key: 'source'},
          {key: 'name', format: (name, row) => colorize(row.level, name)},
          {key: 'level', format: (level) => colorize(level, level)},
          {key: 'title', label: 'desc'},
          {key: 'count'}
        ]
      })
    }
  }
}

module.exports = {
  topic: 'apps',
  command: 'errors',
  description: 'view app errors',
  needsAuth: true,
  needsApp: true,
  flags: [
    {name: 'json', description: 'output in json format'},
    {name: 'hours', hasValue: true, description: 'number of hours to look back (default 24)'},
    {name: 'router', description: 'show only router errors'},
    {name: 'dyno', description: 'show only dyno errors'}
  ],
  run: cli.command(co.wrap(run))
}
