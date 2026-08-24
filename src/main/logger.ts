import pino, { multistream, type DestinationStream } from 'pino'
import { is } from '@electron-toolkit/utils'
import { LOGS_PATH } from './config'
import { join } from 'path'
import { createWriteStream } from 'fs'
import { Writable } from 'stream'

/**
 * 按日期滚动的文件流：写入 app-YYYY-MM-DD.log，跨天自动切换新文件。
 * 不做任何自动清理——开发者手动删除旧日志文件。
 */
function createDailyDestination(basePath: string): DestinationStream {
  const today = (): string => new Date().toISOString().slice(0, 10)
  let currentDate = today()
  let fileStream = createWriteStream(`${basePath}-${currentDate}.log`, { flags: 'a' })

  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const date = today()
      if (date !== currentDate) {
        currentDate = date
        fileStream.end()
        fileStream = createWriteStream(`${basePath}-${date}.log`, { flags: 'a' })
      }
      fileStream.write(chunk)
      callback()
    },
    destroy(_err, cb) {
      fileStream.end()
      cb(null)
    },
    final(cb) {
      fileStream.end()
      cb(null)
    }
  }) as DestinationStream
}

// 创建日志实例
// 生产环境按日期分文件（app-YYYY-MM-DD.log / error-YYYY-MM-DD.log），
// 不自动清理，开发者手动删除旧文件
const logger = is.dev
  ? pino({
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname'
        }
      }
    })
  : pino(
      { level: 'info' },
      multistream([
        { level: 'info', stream: createDailyDestination(join(LOGS_PATH, 'app')) },
        { level: 'error', stream: createDailyDestination(join(LOGS_PATH, 'error')) }
      ])
    )

export default logger
