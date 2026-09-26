import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

/**
 * 管理端 JWT Guard（/admin/*）
 * POST /admin/auth/login 换 accessToken（8h）
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    if (!token) throw new UnauthorizedException('missing admin token')

    try {
      await this.jwtService.verifyAsync(token)
      return true
    } catch {
      throw new UnauthorizedException('invalid or expired admin token')
    }
  }
}
