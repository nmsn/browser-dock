import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { AdminJwtGuard } from '../auth/admin-jwt.guard'
import { RoomsService } from './rooms.service'

export class CreateRoomDto {
  @IsString()
  @MinLength(6)
  taobaoAccountId!: string

  @IsString()
  @MaxLength(100)
  roomName!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roomName?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class ListRoomsQuery {
  @IsOptional()
  @IsIn(['true', 'false'])
  enabled?: 'true' | 'false'
}

/**
 * 直播间维护（简化管理 REST，apps/server/README.md 第 6 节）
 * taobaoAccountId（userNumId）↔ 直播间 一对一绑定
 */
@UseGuards(AdminJwtGuard)
@ApiTags('admin/rooms')
@ApiBearerAuth('admin')
@Controller('admin/rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  @ApiOperation({ summary: '房间列表' })
  list(@Query() _query: ListRoomsQuery) {
    return this.roomsService.list()
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.roomsService.get(id)
  }

  @Post()
  create(@Body() dto: CreateRoomDto) {
    return this.roomsService.create(dto)
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomDto) {
    return this.roomsService.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.roomsService.remove(id)
  }
}
