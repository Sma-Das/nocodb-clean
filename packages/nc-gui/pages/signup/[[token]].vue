<script setup lang="ts">
import { validatePassword } from 'nocodb-sdk'
import type { RuleObject } from 'ant-design-vue/es/form'

definePageMeta({
  requiresAuth: false,
})

const { $e } = useNuxtApp()

const route = useRoute()

const { appInfo, signIn } = useGlobal()

const { api, error } = useApi({ useGlobalInstance: true })

const { t } = useI18n()

const { clearWorkspaces } = useWorkspace()

const formValidator = ref()

const form = reactive({
  email: '',
  password: '',
})

const formRules = {
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
  ] as RuleObject[],
  password: [
    {
      validator: (_: unknown, v: string) => {
        return new Promise((resolve, reject) => {
          const { error, valid } = validatePassword(v)
          if (valid) return resolve()
          reject(new Error(error))
        })
      },
    },
  ] as RuleObject[],
}

async function signUp() {
  if (!formValidator.value.validate()) return

  resetError()

  const data: any = {
    ...form,
    token: route.params.token,
  }

  data.ignore_subscribe = true

  return api.auth.signup(data).then(async (user) => {
    signIn(user.token!)

    $e('a:auth:sign-up')

    try {
      // The home route opens the user's workspace or last visited base.
      return await navigateTo('/')
    } catch (e) {
      console.error(e)
    }
  })
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

onMounted(async () => {
  await clearWorkspaces()
})
</script>

<template>
  <div>
    <NuxtLayout>
      <div class="md:bg-nc-bg-gray-extralight signup h-full min-h-[600px] flex flex-col justify-center items-center">
        <div
          class="bg-nc-bg-default flex flex-col justify-center gap-2 w-full max-w-[440px] mx-auto p-8 md:(rounded-xl border-1 border-nc-border-gray-medium)"
        >
          <GeneralNocoIcon :size="40" />

          <h1 class="text-xl font-semibold tracking-tight self-center mt-2 mb-4">
            {{ $t('general.signUp') }}
          </h1>

          <p v-if="appInfo.firstUser" class="-mt-3 mb-4 self-center text-center text-sm text-nc-content-gray-subtle">
            {{ $t('msg.info.signUp.superAdmin') }}
          </p>

          <a-form ref="formValidator" :model="form" layout="vertical" no-style @finish="signUp">
            <template v-if="!appInfo.disableEmailAuth">
              <Transition name="layout">
                <div
                  v-if="error"
                  class="mb-4 rounded-lg border-1 border-nc-border-red bg-nc-bg-red-light px-3 py-2 text-sm text-nc-content-red-dark"
                  data-testid="nc-signup-error"
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
                  size="large"
                  :placeholder="$t('msg.info.signUp.workEmail')"
                  @focus="resetError"
                />
              </a-form-item>

              <a-form-item :label="$t('labels.password')" name="password" :rules="formRules.password">
                <a-input-password
                  v-model:value="form.password"
                  autocomplete="new-password"
                  size="large"
                  class="password"
                  :placeholder="$t('msg.info.signUp.enterPassword')"
                  @focus="resetError"
                />
              </a-form-item>
            </template>
            <div class="flex flex-col gap-3 items-stretch mt-2">
              <template v-if="!appInfo.disableEmailAuth">
                <button class="scaling-btn w-full" type="submit">
                  {{ $t('general.signUp') }}
                </button>
              </template>
              <a
                v-if="appInfo.googleAuthEnabled"
                :href="`${appInfo.ncSiteUrl}/auth/google`"
                class="scaling-btn secondary w-full !no-underline"
              >
                <span class="flex items-center justify-center gap-2">
                  <LogosGoogleGmail />

                  {{ $t('labels.signUpWithProvider', { provider: 'Google' }) }}
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
                        {{ $t('general.signUp') }}
                      </template>
                    </span>
                  </button>
                </a>
              </div>

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
.signup {
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
