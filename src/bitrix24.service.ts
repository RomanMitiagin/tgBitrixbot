import axios from 'axios';
import config from './config';
import * as fs from 'fs';
import * as path from 'path';

const webhooksFilePath = path.join(__dirname, '../webhooks.json');
const userIdsFilePath = path.join(__dirname, '../user_ids.json');

export class Bitrix24Service {
  private userWebhooks: Map<number, string>;
  private userIds: Map<number, string>;

  constructor() {
    this.userWebhooks = new Map();
    this.userIds = new Map();
    this.loadWebhooks();
    this.loadUserIds();
  }

  private loadWebhooks(): void {
    if (fs.existsSync(webhooksFilePath)) {
      const data = fs.readFileSync(webhooksFilePath, 'utf8');
      const webhooks = JSON.parse(data);
      for (const [chatId, webhookUrl] of Object.entries(webhooks)) {
        this.userWebhooks.set(Number(chatId), webhookUrl as string);
      }
    }
  }

  private saveWebhooks(): void {
    const webhooks = Object.fromEntries(this.userWebhooks);
    fs.writeFileSync(webhooksFilePath, JSON.stringify(webhooks, null, 2), 'utf8');
  }

  private loadUserIds(): void {
    if (fs.existsSync(userIdsFilePath)) {
      const data = fs.readFileSync(userIdsFilePath, 'utf8');
      const userIds = JSON.parse(data);
      for (const [chatId, userId] of Object.entries(userIds)) {
        this.userIds.set(Number(chatId), userId as string);
      }
    }
  }

  private saveUserIds(): void {
    const userIds = Object.fromEntries(this.userIds);
    fs.writeFileSync(userIdsFilePath, JSON.stringify(userIds, null, 2), 'utf8');
  }

  setUserWebhook(chatId: number, webhookUrl: string): void {
    this.userWebhooks.set(chatId, webhookUrl);
    this.saveWebhooks();
  }

  setUserId(chatId: number, userId: string): void {
    this.userIds.set(chatId, userId);
    this.saveUserIds();
  }

  getUserWebhook(chatId: number): string {
    return this.userWebhooks.get(chatId);
  }

  getUserId(chatId: number): string {
    return this.userIds.get(chatId);
  }

  async getPlans(chatId: number, period: 'day' | 'week' | 'month'): Promise<string> {
    const webhookUrl = this.getUserWebhook(chatId);
    const periodMap = {
      day: 1,
      week: 7,
      month: 30,
    };

    if (!webhookUrl) {
      return 'Webhook URL не установлен. Пожалуйста, установите Webhook URL для Битрикс24.';
    }

    try {
      const response = await axios.get(`${webhookUrl}/tasks.task.list`, {
        params: {
          filter: {
            '>DEADLINE': new Date(Date.now()).toISOString(),
            '<DEADLINE': new Date(
              Date.now() + periodMap[period] * 24 * 60 * 60 * 1000
            ).toISOString(),
          },
        },
      });

      const tasks = response.data.result.tasks;
      if (tasks.length === 0) {
        return 'Нет задач на выбранный период.';
      }

      return tasks.map(task => `- ${task.title} (дедлайн: ${task.deadline})`).join('\n');
    } catch (err) {
      console.error('Ошибка получения задач из Битрикс24:', err);
      return 'Извините, произошла ошибка при получении задач из Битрикс24.';
    }
  }

  async createTask(chatId: number, title: string, description: string, deadline: string): Promise<string> {
    const webhookUrl = this.getUserWebhook(chatId);
    const userId = this.getUserId(chatId);

    if (!webhookUrl) {
      return 'Не удалось создать задачу в Битрикс24: Webhook URL не найден.';
    }

    if (!userId) {
      return 'Не удалось создать задачу в Битрикс24: идентификатор пользователя не найден.';
    }

    try {
      const response = await axios.post(`${webhookUrl}/tasks.task.add`, {
        fields: {
          TITLE: title,
          DESCRIPTION: description,
          RESPONSIBLE_ID: userId,
          DEADLINE: deadline,
        },
      });

      if (response.data.result) {
        return 'Задача успешно создана в Битрикс24.';
      } else {
        return 'Не удалось создать задачу в Битрикс24.';
      }
    } catch (err) {
      console.error('Ошибка создания задачи в Битрикс24:', err);
      return 'Извините, произошла ошибка при создании задачи в Битрикс24.';
    }
  }
}
