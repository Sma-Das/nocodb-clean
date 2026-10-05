<script setup lang="ts">
import type { RuleObject } from 'ant-design-vue/es/form'

definePageMeta({
  requiresAuth: false,
  title: 'title.headLogin',
})

const route = useRoute()

const { signIn: _signIn, appInfo } = useGlobal()

const { api, error } = useApi({ useGlobalInstance: true })

const { t } = useI18n()

useSidebar('nc-left-sidebar', { hasSidebar: false })

const formValidator = ref()

const form = reactive({
  email: '',
  password: '',
})

const formRules: Record<string, RuleObject[]> = {
  email: [
    // E-mail is required
    { required: true, message: t('msg.error.signUpRules.emailRequired') },
    // E-mail must be valid format
    {
      validator: (_: unknown, v: string) => {
        return new Promise((resolve, reject) => {
          if (!v?.length || validateEmail(v.trim())) return resolve()

          reject(new Error(t('msg.error.signUpRules.emailInvalid')))
        })
      },
      message: t('msg.error.signUpRules.emailInvalid'),
    },
  ],
  password: [
    // Password is required
    { required: true, message: t('msg.error.signUpRules.passwdRequired') },
  ],
}

async function signIn() {
  if (!formValidator.value.validate()) return

  resetError()

  api.auth.signin(form).then(async ({ token }) => {
    _signIn(token!)

    await navigateTo({
      path: '/',
      query: route.query,
    })
  })
}

function resetError() {
  if (error.value) error.value = null
}

function navigateSignUp() {
  navigateTo({
    path: '/signup',
    query: route.query,
  })
}

function navigateForgotPassword() {
  navigateTo({
    path: '/forgot-password',
    query: route.query,
  })
}
</script>

<template>
  <div>
    <NuxtLayout>
      <div
        data-testid="nc-form-signin"
        class="md:bg-nc-bg-gray-extralight signin h-full min-h-[600px] flex flex-col justify-center items-center nc-form-signin"
      >
        <div
          class="bg-nc-bg-default flex flex-col justify-center gap-2 w-full max-w-[440px] mx-auto p-8 md:(rounded-xl border-1 border-nc-border-gray-medium)"
        >
          <GeneralNocoIcon :size="40" />

          <h1 class="text-xl font-semibold tracking-tight self-center mt-2 mb-4">{{ $t('general.signIn') }}</h1>

          <a-form ref="formValidator" :model="form" layout="vertical" no-style @finish="signIn">
            <template v-if="!appInfo.disableEmailAuth">
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
                  type="email"
                  autocomplete="email"
                  data-testid="nc-form-signin__email"
                  size="large"
                  :placeholder="$t('msg.info.signUp.workEmail')"
                  @focus="resetError"
                />
              </a-form-item>

              <a-form-item :label="$t('labels.password')" name="password" :rules="formRules.password">
                <a-input-password
                  v-model:value="form.password"
                  autocomplete="current-password"
                  data-testid="nc-form-signin__password"
                  size="large"
                  class="password"
                  :placeholder="$t('msg.info.signUp.enterPassword')"
                  @focus="resetError"
                />
              </a-form-item>

              <div class="hidden md:block text-right -mt-2 mb-4">
                <nuxt-link class="text-sm" @click="navigateForgotPassword">
                  {{ $t('msg.info.signUp.forgotPassword') }}
                </nuxt-link>
              </div>
            </template>

            <div class="flex flex-col gap-3 items-stretch mt-2">
              <template v-if="!appInfo.disableEmailAuth">
                <button data-testid="nc-form-signin__submit" class="scaling-btn w-full" type="submit">
                  {{ $t('general.signIn') }}
                </button>
              </template>
              <a
                v-if="appInfo.googleAuthEnabled"
                :href="`${appInfo.ncSiteUrl}/auth/google`"
                class="scaling-btn secondary w-full !no-underline"
              >
                <span class="flex items-center justify-center gap-2">
                  <LogosGoogleGmail />

                  {{ $t('labels.signInWithProvider', { provider: 'Google' }) }}
                </span>
              </a>

              <div v-if="appInfo.oidcAuthEnabled" class="flex flex-col">
                <a :href="`${appInfo.ncSiteUrl}/auth/oidc`" class="!no-underline">
                  <button type="button" class="scaling-btn w-full">
                    <span class="flex items-center justify-center gap-2">
                      <MdiLogin />

                      <template v-if="!appInfo.disableEmailAuth">
                        {{ $t('labels.signUpWithProvider', { provider: appInfo.oidcProviderName || 'OpenID Connect' }) }}
                      </template>
                      <template v-else>
                        {{ $t('general.signIn') }}
                      </template>
                    </span>
                  </button>
                </a>
              </div>

              <div v-if="!appInfo.inviteOnlySignup" class="text-center text-sm text-nc-content-gray-subtle">
                {{ $t('msg.info.signUp.dontHaveAccount') }}
                <nuxt-link @click="navigateSignUp">{{ $t('general.signUp') }}</nuxt-link>
              </div>
              <template v-if="!appInfo.disableEmailAuth">
                <div class="md:hidden text-center">
                  <nuxt-link class="text-sm" @click="navigateForgotPassword">
                    {{ $t('msg.info.signUp.forgotPassword') }}
                  </nuxt-link>
                </div>
              </template>
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
