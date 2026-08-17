import pino from 'pino'
import { is } from '@electron-toolkit/utils'
import { LOGS_PATH } from './config'
import { join } from 'path'

// 创建日志实例
const logger = pino({
  level: is.dev ? 'debug' : 'info',
  transport: is.dev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname'
        }
      }
    : undefined,
  ...(is.dev
    ? {}
    : {
        targets: [
          {
            target: 'pino/file',
            level: 'info',
            options: { destination: join(LOGS_PATH, 'app.log'), mkdir: true }
          },
          {
            target: 'pino/file',
            level: 'error',
            options: { destination: join(LOGS_PATH, 'error.log'), mkdir: true }
          }
        ]
      })
})

export default logger
