import { defineNuxtPlugin } from '#app';
import { defineRule, configure } from 'vee-validate';
import { required, alpha_spaces, regex, numeric, min, email } from '@vee-validate/rules';
import { localize } from '@vee-validate/i18n';

interface ValidationContext {
  rule?: {
    name: string;
    params?: unknown[] | Record<string, unknown>;
  };
}

export const maxValidator = (value: string, [max]: [number]): true | string => {
  return value.length <= max || `Максимальная длина ${max} символов`;
};

export default defineNuxtPlugin(() => {
  defineRule('required', required);
  defineRule('alpha_spaces', alpha_spaces);
  defineRule('numeric', numeric);
  defineRule('regex', regex);
  defineRule('min', min);
  defineRule('max', maxValidator);
  defineRule('email', email);

  configure({
    generateMessage: localize('ru', {
      messages: {
        required: 'Обязательное поле',
        alpha_spaces: 'Поле может содержать только буквы и пробелы',
        regex: 'Неверный формат ввода',
        min: (ctx: ValidationContext) => {
          if (ctx.rule?.params && Array.isArray(ctx.rule.params)) {
            return `Минимальная длина ${ctx.rule.params[0]} символов`;
          }
          return 'Поле не соответствует минимальной длине';
        },
        max: `${maxValidator}`,
        numeric: 'Поле может содержать только числа',
        email: 'Невалидный адрес',
        password: 'Поле может содержать только буквы, цифры и символы',
      },
    }),
    validateOnInput: true,
  });
});
