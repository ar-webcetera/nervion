import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Users } from '../../users/entities/users.entity';

@Entity({ name: 'api_tokens' })
export class ApiToken {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 'CI/CD pipeline' })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token_hash: string;

  @ApiProperty({ example: 42 })
  @Column()
  user_id: number;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @ApiProperty({ example: null, nullable: true })
  @Column({ type: 'timestamp', nullable: true })
  last_used_at: Date | null;

  @ApiProperty({ example: null, nullable: true })
  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @ApiProperty({ example: '2026-03-24T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
