<script setup lang="ts">
import { validatePassword } from 'nocodb-sdk'

definePageMeta({
  requiresAuth: false,
})

const { api, isLoading, error } = useApi()

const { t } = useI18n()

const route = useRoute()

const form = reactive({
  password: '',
  newPassword: '',
})

const formValidator = ref()

async function resetPassword() {
  if (form.newPassword !== form.password) {
    error.value = 'Passwords do not match'
    return
  }
  const { error: mesg, valid } = validatePassword(form.password)

  if (!valid) {
    error.value = mesg.includes('8') ? 'Password must be at least 8 characters' : mesg
    return
  }

  resetError()

  try {
    await api.auth.passwordReset(route.params.id as string, {
      password: form.password,
    })
    navigateTo('/signin')
  } catch (e: any) {
    message.error(await extractSdkResponseErrorMsg(e))
  }
}

function resetError() {
  if (error.value) error.value = null
}
</script>

<template>
  <div>
    <NuxtLayout>
      <div
        class="md:bg-nc-bg-gray-extralight signin forgot-password h-full min-h-[600px] flex flex-col justify-center items-center"
      >
        <div
          class="bg-nc-bg-default flex flex-col justify-center gap-2 w-full max-w-[440px] mx-auto p-8 md:(rounded-xl border-1 border-nc-border-gray-medium)"
        >
          <LazyGeneralNocoIcon :size="40" />

          <h1 class="text-xl font-semibold tracking-tight self-center mt-2 mb-4">{{ $t('title.resetPassword') }}</h1>

          <a-form ref="formValidator" layout="vertical" :model="form" no-style @finish="resetPassword">
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

            <a-form-item
              :label="$t('placeholder.password.new')"
              name="password"
              :rules="[{ required: true, message: t('msg.error.signUpRules.passwdRequired') }]"
            >
              <a-input-password
                v-model:value="form.password"
                :placeholder="$t('placeholder.password.new')"
                size="large"
                class="password"
                @focus="resetError"
              />
            </a-form-item>

            <a-form-item
              :label="$t('placeholder.password.confirm')"
              name="newPassword"
              :rules="[{ required: true, message: t('msg.error.signUpRules.passwdRequired') }]"
            >
              <a-input-password
                v-model:value="form.newPassword"
                type="password"
                size="large"
                class="password"
                :placeholder="$t('placeholder.password.confirm')"
                @focus="resetError"
              />
            </a-form-item>

            <div class="flex flex-col gap-3 items-stretch mt-2">
              <NcButton type="primary" :is-loading="isLoading" html-type="submit" full-width>
                <span class="w-full text-center">{{ $t('general.reset') }}</span>
              </NcButton>

              <nuxt-link to="/signin" class="text-sm text-center">{{ $t('general.signIn') }}</nuxt-link>
            </div>
          </a-form>
        </div>
      </div>
    </NuxtLayout>
  </div>
</template>

<style lang="scss">
.signin {
  .ant-input-affix-wrapper,
  .ant-input {
    @apply !appearance-none my-1 border-1 border-solid border-nc-border-gray-medium rounded-lg;
  }

  .password {
    input {
      @apply !border-none !m-0;
    }
  }
}
</style>
