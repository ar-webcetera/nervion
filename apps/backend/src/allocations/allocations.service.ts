import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Allocations } from './entities/allocation.entity';
import { CreateAllocationDto } from './dto/create-allocation.dto';
import { UpdateAllocationDto } from './dto/update-allocation.dto';
import { GetAllocationsDto } from './dto/get-allocations.dto';
import { ROLES } from '../common/enums/roles.enum';
import { ProjectMembers } from '../projects/entities/project.entity';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

@Injectable()
export class AllocationsService {
  constructor(
    @InjectRepository(Allocations)
    private allocationsRepository: Repository<Allocations>,
    @InjectRepository(ProjectMembers)
    private projectMembersRepository: Repository<ProjectMembers>,
  ) {}

  async create(createAllocationDto: CreateAllocationDto): Promise<Allocations> {
    const allocation = this.allocationsRepository.create(createAllocationDto);
    const saved = await this.allocationsRepository.save(allocation);
    return await this.findOne(saved.id);
  }

  async findAll(filters: GetAllocationsDto, currentUser: AuthenticatedUser): Promise<Allocations[]> {
    const query = this.allocationsRepository
      .createQueryBuilder('allocation')
      .leftJoinAndSelect('allocation.user', 'user')
      .leftJoinAndSelect('allocation.project', 'project');

    if (currentUser.role !== ROLES.admin) {
      const memberships = await this.projectMembersRepository.find({
        where: { user: { id: currentUser.id } },
        relations: ['project'],
      });
      const projectIds = memberships.map((m) => m.project.id);
      if (projectIds.length === 0) return [];
      query.andWhere('allocation.project_id IN (:...projectIds)', { projectIds });
    } else if (filters.user_id) {
      query.andWhere('allocation.user_id = :user_id', { user_id: filters.user_id });
    }

    if (filters.project_id) {
      query.andWhere('allocation.project_id = :project_id', { project_id: filters.project_id });
    }

    if (filters.start_date && filters.end_date) {
      query.andWhere('(allocation.start_date <= :end_date AND allocation.end_date >= :start_date)', {
        start_date: filters.start_date,
        end_date: filters.end_date,
      });
    } else if (filters.start_date) {
      query.andWhere('allocation.end_date >= :start_date', { start_date: filters.start_date });
    } else if (filters.end_date) {
      query.andWhere('allocation.start_date <= :end_date', { end_date: filters.end_date });
    }

    query.orderBy('allocation.start_date', 'ASC');

    return await query.getMany();
  }

  async findOne(id: number): Promise<Allocations> {
    const allocation = await this.allocationsRepository.findOne({
      where: { id },
      relations: ['user', 'project'],
    });

    if (!allocation) {
      throw new NotFoundException(`Allocation with ID ${id} not found`);
    }

    return allocation;
  }

  async update(id: number, updateAllocationDto: UpdateAllocationDto): Promise<Allocations> {
    const allocation = await this.findOne(id);
    Object.assign(allocation, updateAllocationDto);
    return await this.allocationsRepository.save(allocation);
  }

  async remove(id: number): Promise<void> {
    const allocation = await this.findOne(id);
    await this.allocationsRepository.remove(allocation);
  }
}
