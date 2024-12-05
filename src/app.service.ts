import { Injectable } from '@nestjs/common';
import * as TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import config from './config';
import { Bitrix24Service } from './bitrix24.service';

@Injectable()
export class AppService {
  private bot: TelegramBot;
  private transcriptionMap: Map<number, string>;
  private bitrix24Service: Bitrix24Service;

  constructor() {
    const token = config.telegramBotToken;
    this.bot = new TelegramBot(token, { polling: true });
    this.transcriptionMap = new Map();
    this.bitrix24Service = new Bitrix24Service();

    console.log('Бот запущен...');

    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      console.log(`Получена команда /start от chatId: ${chatId}`);
      const opts = {
        reply_markup: {
          keyboard: [
            [
              {
                text: 'Создать задачу'
              },
              {
                text: 'Планы на день'
              }
            ],
            [
              {
                text: 'Планы на неделю'
              },
              {
                text: 'Планы на месяц'
              },
              {
                text: 'Установить Webhook URL'
              },
              {
                text: 'Установить User ID'
              }
            ]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      };
      this.bot.sendMessage(chatId, 'Добро пожаловать! Выберите опцию:', opts);
    });

    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;

      if (text === 'Создать задачу') {
        if (!this.bitrix24Service.getUserId(chatId)) {
          this.bot.sendMessage(chatId, 'Пожалуйста, сначала установите ваш User ID для Битрикс24 с помощью команды "Установить User ID".');
          return;
        }
        if (!this.bitrix24Service.getUserWebhook(chatId)) {
          this.bot.sendMessage(chatId, 'Пожалуйста, сначала установите ваш Webhook URL для Битрикс24 с помощью команды "Установить Webhook URL".');
          return;
        }
        this.bot.sendMessage(chatId, 'Пожалуйста, отправьте голосовое сообщение для расшифровки.');
      } else if (text === 'Изменить текст') {
        if (this.transcriptionMap.has(chatId)) {
          this.bot.sendMessage(chatId, `Текущий текст: ${this.transcriptionMap.get(chatId)}\nВведите новый текст:`);
          this.bot.once('message', async (msg) => {
            const newText = msg.text;
            this.transcriptionMap.set(chatId, newText);
            this.bot.sendMessage(chatId, `Текст обновлен: ${newText}`);
            this.bot.sendMessage(chatId, 'Введите заголовок для задачи:');
            this.bot.once('message', async (msg) => {
              const title = msg.text;
              this.bot.sendMessage(chatId, 'Введите дедлайн для задачи (в формате YYYY-MM-DD HH:MM:SS):');
              this.bot.once('message', async (msg) => {
                const deadline = msg.text;
                const result = await this.bitrix24Service.createTask(chatId, title, newText, deadline);
                this.bot.sendMessage(chatId, result);
              });
            });
          });
        } else {
          this.bot.sendMessage(chatId, 'Нет текста для изменения. Пожалуйста, сначала отправьте голосовое сообщение.');
        }
      } else if (text === 'Планы на день') {
        const plans = await this.bitrix24Service.getPlans(chatId, 'day');
        this.bot.sendMessage(chatId, `Планы на день:\n${plans}`);
      } else if (text === 'Планы на неделю') {
        const plans = await this.bitrix24Service.getPlans(chatId, 'week');
        this.bot.sendMessage(chatId, `Планы на неделю:\n${plans}`);
      } else if (text === 'Планы на месяц') {
        const plans = await this.bitrix24Service.getPlans(chatId, 'month');
        this.bot.sendMessage(chatId, `Планы на месяц:\n${plans}`);
      } else if (text === 'Установить Webhook URL') {
        this.bot.sendMessage(chatId, 'Пожалуйста, отправьте новый Webhook URL для Битрикс24.');
        this.bot.once('message', (msg) => {
          const webhookUrl = msg.text;
          this.bitrix24Service.setUserWebhook(chatId, webhookUrl);
          this.bot.sendMessage(chatId, `Webhook URL установлен: ${webhookUrl}`);
        });
      } else if (text === 'Установить User ID') {
        this.bot.sendMessage(chatId, 'Пожалуйста, отправьте ваш User ID для Битрикс24.');
        this.bot.once('message', (msg) => {
          const userId = msg.text;
          this.bitrix24Service.setUserId(chatId, userId);
          this.bot.sendMessage(chatId, `User ID установлен: ${userId}`);
        });
      }
    });

    this.bot.on('voice', async (msg) => {
      const chatId = msg.chat.id;
      const fileId = msg.voice.file_id;

      const file = await this.bot.getFile(fileId);
      const filePath = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

      const response = await axios.get(filePath, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data, 'binary');

      const transcription = await this.transcribeAudio(buffer);
      console.log(`Транскрипция: ${transcription}`);
      this.transcriptionMap.set(chatId, transcription);
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Изменить текст',
                callback_data: 'edit_text'
              },
              {
                text: 'Подтвердить и создать задачу',
                callback_data: 'confirm_and_create_task'
              }
            ]
          ]
        }
      };
      this.bot.sendMessage(chatId, `Транскрипция: ${transcription}`, opts);
    });

    this.bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      if (callbackQuery.data === 'edit_text') {
        if (this.transcriptionMap.has(chatId)) {
          this.bot.sendMessage(chatId, `Текущий текст: ${this.transcriptionMap.get(chatId)}\nВведите новый текст:`);
          this.bot.once('message', async (msg) => {
            const newText = msg.text;
            this.transcriptionMap.set(chatId, newText);
            this.bot.sendMessage(chatId, `Текст обновлен: ${newText}`);
            this.bot.sendMessage(chatId, 'Введите заголовок для задачи:');
            this.bot.once('message', async (msg) => {
              const title = msg.text;
              this.bot.sendMessage(chatId, 'Введите дедлайн для задачи (в формате YYYY-MM-DD HH:MM:SS):');
              this.bot.once('message', async (msg) => {
                const deadline = msg.text;
                const result = await this.bitrix24Service.createTask(chatId, title, newText, deadline);
                this.bot.sendMessage(chatId, result);
              });
            });
          });
        } else {
          this.bot.sendMessage(chatId, 'Нет текста для изменения. Пожалуйста, сначала отправьте голосовое сообщение.');
        }
      } else if (callbackQuery.data === 'confirm_and_create_task') {
        if (this.transcriptionMap.has(chatId)) {
          const confirmedText = this.transcriptionMap.get(chatId);
          if (!this.bitrix24Service.getUserId(chatId)) {
            this.bot.sendMessage(chatId, 'Пожалуйста, сначала установите ваш User ID для Битрикс24 с помощью команды "Установить User ID".');
            return;
          }
          if (!this.bitrix24Service.getUserWebhook(chatId)) {
            this.bot.sendMessage(chatId, 'Пожалуйста, сначала установите ваш Webhook URL для Битрикс24 с помощью команды "Установить Webhook URL".');
            return;
          }
          this.bot.sendMessage(chatId, 'Введите заголовок для задачи:');
          this.bot.once('message', async (msg) => {
            const title = msg.text;
            this.bot.sendMessage(chatId, 'Введите дедлайн для задачи (в формате YYYY-MM-DD HH:MM:SS):');
            this.bot.once('message', async (msg) => {
              const deadline = msg.text;
              const result = await this.bitrix24Service.createTask(chatId, title, confirmedText, deadline);
              this.bot.sendMessage(chatId, `Задача создана с текстом: ${confirmedText}`);
              this.bot.sendMessage(chatId, result);
            });
          });
        } else {
          this.bot.sendMessage(chatId, 'Нет текста для подтверждения. Пожалуйста, сначала отправьте голосовое сообщение.');
        }
      }
    });
  }

  async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    try {
      const uploadResponse = await axios.post('https://api.assemblyai.com/v2/upload', audioBuffer, {
        headers: {
          'authorization': config.assemblyAIKey,
          'content-type': 'application/octet-stream',
        },
      });

      const transcriptResponse = await axios.post('https://api.assemblyai.com/v2/transcript', {
        audio_url: uploadResponse.data.upload_url,
        language_code: 'ru', // Указываем русский язык
      }, {
        headers: {
          'authorization': config.assemblyAIKey,
          'content-type': 'application/json',
        },
      });

      let transcriptId = transcriptResponse.data.id;
      let transcriptStatus = transcriptResponse.data.status;
      let transcriptText = '';

      while (transcriptStatus !== 'completed' && transcriptStatus !== 'failed') {
        const pollingResponse = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          headers: {
            'authorization': config.assemblyAIKey,
          },
        });

        transcriptStatus = pollingResponse.data.status;
        if (transcriptStatus === 'completed') {
          transcriptText = pollingResponse.data.text;
        } else if (transcriptStatus === 'failed') {
          throw new Error('Transcription failed');
        } else {
          await new Promise(resolve => setTimeout(resolve, 5000)); // Ждем 5 секунд перед повторной проверкой
        }
      }

      return transcriptText;
    } catch (err) {
      console.error('Ошибка транскрипции аудио:', err);
      return 'Извините, произошла ошибка при транскрипции аудио.';
    }
  }
}
