import { AuditActionType } from "./audit-action-type.enum";
import { AuditEntityType } from "./audit-entity-type.enum";
import { AuditSourceType } from "./audit-source-type.enum";

export const AUDIT_ACTION_LABELS: Record<AuditActionType, string> = {
  [AuditActionType.AUTH_LOGIN_SUCCESS]: "Успешный вход",
  [AuditActionType.AUTH_LOGIN_FAILED]: "Неуспешный вход",
  [AuditActionType.AUTH_LOGOUT]: "Выход из системы",
  [AuditActionType.TASK_CREATED]: "Создание задачи",
  [AuditActionType.TASK_UPDATED]: "Обновление задачи",
  [AuditActionType.TASK_DELETED]: "Удаление задачи",
  [AuditActionType.TASK_COMPLETED]: "Выполнение recurring-задачи",
  [AuditActionType.TASK_UNCOMPLETED]: "Снятие выполнения recurring-задачи",
  [AuditActionType.TASK_RECURRENCE_CHANGED]: "Изменение повторения задачи",
  [AuditActionType.PROJECT_CREATED]: "Создание проекта",
  [AuditActionType.PROJECT_UPDATED]: "Обновление проекта",
  [AuditActionType.PROJECT_DELETED]: "Удаление проекта",
  [AuditActionType.PROJECT_MEMBERS_UPDATED]: "Обновление участников проекта",
  [AuditActionType.USER_CREATED]: "Создание пользователя",
  [AuditActionType.USER_UPDATED]: "Обновление пользователя",
  [AuditActionType.USER_ARCHIVED]: "Архивация пользователя",
  [AuditActionType.USER_RESTORED]: "Восстановление пользователя",
  [AuditActionType.API_TOKEN_CREATED]: "Создание API-токена",
  [AuditActionType.API_TOKEN_DELETED]: "Удаление API-токена",
  [AuditActionType.TIMELOG_CREATED]: "Создание таймлога",
  [AuditActionType.TIMELOG_UPDATED]: "Обновление таймлога",
  [AuditActionType.TIMELOG_DELETED]: "Удаление таймлога",
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  [AuditEntityType.AUTH]: "Авторизация",
  [AuditEntityType.TASK]: "Задача",
  [AuditEntityType.PROJECT]: "Проект",
  [AuditEntityType.USER]: "Пользователь",
  [AuditEntityType.API_TOKEN]: "API-токен",
  [AuditEntityType.TIMELOG]: "Таймлог",
};

export const AUDIT_SOURCE_LABELS: Record<AuditSourceType, string> = {
  [AuditSourceType.WEB]: "Веб",
  [AuditSourceType.API_TOKEN]: "API-токен",
  [AuditSourceType.SYSTEM]: "Система",
};
