<script setup lang="ts">
import type { RuleObject } from 'ant-design-vue/es/form'

definePageMeta({
  requiresAuth: false,
})

const route = useRoute()

const { api, error } = useApi({ useGlobalInstance: true })

const { t } = useI18n()

const success = ref(false)

const formValidator = ref()

const form = reactive({
  email: '',
})

const formRules = {
  email: [
    // E-mail is required
    { required: true, message: t('msg.error.signUpRules.emailRequired') },
    // E-mail must be valid format
    {
      validator: (_: unknown, v: string) => {
        return new Promise((resolve, reject) => {
          if (!v?.length || validateEmail(v)) return resolve()

          reject(new Error(t('msg.error.signUpRules.emailInvalid')))
        })
      },
      message: t('msg.error.signUpRules.emailInvalid'),
    },
  ] as RuleObject[],
}

async function resetPassword() {
  if (!formValidator.value.validate()) return

  resetError()

  try {
    await api.auth.passwordForgot(form).then(() => {
      success.value = true
    })
  } catch {
    // ignore since error value is set by useApi and will be displayed in UI
  }
}

function resetError() {
  if (error.value) error.value = null
}

function navigateSignIn() {
  navigateTo({
    path: '/signin',
    query: route.query,
  })
}
</script>

<template>
  <div>
    <NuxtLayout>
      <div class="md:bg-nc-bg-gray-extralight forgot-password h-full min-h-[600px] flex flex-col justify-center items-center">
        <div
          class="bg-nc-bg-default flex flex-col justify-center gap-2 w-full max-w-[440px] mx-auto p-8 md:(rounded-xl border-1 border-nc-border-gray-medium)"
        >
          <GeneralNocoIcon :size="40" />

          <div class="self-center flex flex-col justify-center items-center text-center gap-2">
            <h1 class="text-xl font-semibold tracking-tight mt-2 mb-2 w-full">{{ $t('title.resetPassword') }}</h1>

            <p v-if="!success" class="mb-4 text-sm text-nc-content-gray-subtle">
              {{ $t('msg.info.passwordRecovery.message_1') }} {{ $t('msg.info.passwordRecovery.message_2') }}
            </p>

            <template v-else>
              <div class="text-sm text-success flex items-center leading-8 gap-2">
                {{ $t('msg.info.passwordRecovery.success') }} <ClaritySuccessLine />
              </div>

              <nuxt-link @click="navigateSignIn">{{ $t('general.signIn') }}</nuxt-link>
            </template>
          </div>

          <a-form v-if="!success" ref="formValidator" layout="vertical" :model="form" no-style @finish="resetPassword">
            <Transition name="layout">
              <div
                v-if="error"
                class="mb-4 rounded-lg border-1 border-nc-border-red bg-nc-bg-red-light px-3 py-2 text-sm text-nc-content-red-dark"
              >
                <div class="flex items-start gap-2">
                  <MaterialSymbolsWarning class="flex-none mt-0.5" />
                  <div class="break-words">{{ error }}</div>
                </div>
              </div>
            </Transition>

            <a-form-item :label="$t('labels.email')" name="email" :rules="formRules.email">
              <a-input
                v-model:value="form.email"
                size="large"
                :placeholder="$t('msg.info.signUp.workEmail')"
                @focus="resetError"
              />
            </a-form-item>

            <div class="flex flex-col gap-3 items-stretch mt-2">
              <button class="scaling-btn w-full" type="submit">
                {{ $t('activity.sendEmail') }}
              </button>

              <div class="text-center text-sm text-nc-content-gray-subtle">
                {{ $t('msg.info.signUp.alreadyHaveAccount') }}
                <nuxt-link @click="navigateSignIn">{{ $t('general.signIn') }}</nuxt-link>
              </div>
            </div>
          </a-form>
        </div>
      </div>
    </NuxtLayout>
  </div>
</template>

<style lang="scss">
.forgot-password {
  .ant-input-affix-wrapper,
  .ant-input {
    @apply !appearance-none my-1 border-1 border-solid border-nc-border-gray-medium rounded-lg;
  }
}
</style>
