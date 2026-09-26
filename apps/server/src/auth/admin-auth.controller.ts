import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsString } from 'class-validator'
import { loadEnv } from '../config/env'

export class AdminLoginDto {
  @IsString()
  username!: string

  @IsString()
  password!: string
}

/**
 * 管理端登录（阶段一单账号，来自 .env：ADMIN_USER / ADMIN_PASSWORD）
 */
@ApiTags('admin/auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly jwtService: JwtService) {}

  @Post('login')
  @ApiOperation({ summary: '管理端登录，换取 JWT（8h）' })
  login(@Body() dto: AdminLoginDto): { accessToken: string } {
    const env = loadEnv()
    if (dto.username !== env.adminUser || dto.password !== env.adminPassword) {
      throw new UnauthorizedException('invalid admin credentials')
    }
    const accessToken = this.jwtService.sign(
      { sub: dto.username },
      { expiresIn: '8h' }
    )
    return { accessToken }
  }
}
