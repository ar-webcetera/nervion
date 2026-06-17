import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum HealthCheckStatus {
  OK = 'ok',
  FAIL = 'fail',
  UNKNOWN = 'unknown',
}

@Entity({ name: 'healthchecks' })
export class HealthCheck {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 'Procarbon API' })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @ApiProperty({ example: 'https://example.com/health' })
  @Column({ type: 'varchar', length: 1000 })
  url: string;

  @ApiProperty({ example: 60 })
  @Column({ type: 'integer', default: 60 })
  interval_seconds: number;

  @ApiProperty({ example: 10 })
  @Column({ type: 'integer', default: 10 })
  timeout_seconds: number;

  @ApiProperty({ example: 200 })
  @Column({ type: 'integer', default: 200 })
  expected_status: number;

  @ApiProperty({ example: 'uuid-of-chat' })
  @Column({ type: 'varchar', length: 36 })
  chat_id: string;

  @ApiProperty({ example: 1 })
  @Column({ type: 'integer' })
  sender_user_id: number;

  @ApiProperty({ example: true })
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @ApiProperty({ enum: HealthCheckStatus, example: HealthCheckStatus.UNKNOWN })
  @Column({ type: 'varchar', length: 20, default: HealthCheckStatus.UNKNOWN })
  last_status: HealthCheckStatus;

  @ApiProperty({ example: null, nullable: true })
  @Column({ type: 'timestamp', nullable: true })
  last_checked_at: Date | null;

  @ApiProperty({ example: null, nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  last_error: string | null;

  @ApiProperty({ example: '2026-03-26T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @ApiProperty({ example: '2026-03-26T10:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
