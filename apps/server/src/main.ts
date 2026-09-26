import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { loadEnv } from './config/env'

/**
 * Browser Dock 场控服务端
 * - 全局 ValidationPipe：class-validator DTO 校验（IPC 入参不信任原则同样适用于 HTTP）
 * - Swagger：/docs（接口层"实时文档"，见 ADR-0003）
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false
    })
  )
  app.enableShutdownHooks()

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Browser Dock 场控服务端')
    .setDescription('RPA 任务契约（list/claim/report/cancel）+ 执行记录 + 简化管理 REST')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'device')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'admin')
    .build()
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig))

  await app.listen(env.port)
  // eslint-disable-next-line no-console
  console.log(`server listening on :${env.port} (docs at /docs, env=${env.nodeEnv})`)
}

void bootstrap()
