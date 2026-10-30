import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService, PlatformRequest } from './platform-admin.service';
import { PlatformService } from './platform.service';
import {
  CreatePlatformTenantDto,
  PlatformLoginDto,
  UpdatePlatformTenantDto,
  VerifyPlatformIdentityDto,
} from './dto/platform-tenant.dto';

@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly admin: PlatformAdminService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  login(@Body() input: PlatformLoginDto, @Req() req: PlatformRequest, @Res({ passthrough: true }) res: Response) {
    return this.admin.login(input.email, input.password, req, res);
  }

  @Get('auth/me')
  @UseGuards(PlatformAdminGuard)
  me(@Req() req: PlatformRequest) {
    return { email: req.platformAdminEmail };
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Req() req: PlatformRequest, @Res({ passthrough: true }) res: Response) {
    return this.admin.logout(req, res);
  }

  @Get('tenants')
  @UseGuards(PlatformAdminGuard)
  list() {
    return this.platform.listTenants();
  }

  @Post('tenants')
  @UseGuards(PlatformAdminGuard)
  create(@Body() input: CreatePlatformTenantDto, @Req() req: PlatformRequest) {
    return this.platform.createTenant(input, req.platformAdminEmail!);
  }

  @Patch('tenants/:id')
  @UseGuards(PlatformAdminGuard)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdatePlatformTenantDto, @Req() req: PlatformRequest) {
    return this.platform.updateTenant(id, input, req.platformAdminEmail!);
  }

  @Post('tenants/:id/provision')
  @UseGuards(PlatformAdminGuard)
  provision(@Param('id', ParseUUIDPipe) id: string, @Req() req: PlatformRequest) {
    return this.platform.provisionTenant(id, req.platformAdminEmail!);
  }

  @Post('tenants/:id/reconcile')
  @UseGuards(PlatformAdminGuard)
  reconcile(@Param('id', ParseUUIDPipe) id: string, @Req() req: PlatformRequest) {
    return this.platform.reconcileMemberships(id, req.platformAdminEmail!);
  }

  @Post('identities/verify')
  @UseGuards(PlatformAdminGuard)
  verifyIdentity(@Body() input: VerifyPlatformIdentityDto, @Req() req: PlatformRequest) {
    return this.platform.verifyIdentityOwnership(input.email, input.newPassword, req.platformAdminEmail!);
  }
}
