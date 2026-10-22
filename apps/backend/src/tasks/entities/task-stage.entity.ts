import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { TaskStage } from '@tracker/contracts';

@Entity('task_stages')
export class TaskStageEntity implements TaskStage {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar', length: 80 })
  title: string;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'boolean', default: false })
  protected: boolean;
}
