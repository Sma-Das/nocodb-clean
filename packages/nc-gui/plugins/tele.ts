// Preserve instrumentation call sites without tracking users or opening a socket.
export default defineNuxtPlugin((nuxtApp) => {
  const emit = (..._args: any[]) => {}

  nuxtApp.vueApp.directive('e', {})
  nuxtApp.provide('tele', { emit })
  nuxtApp.provide('e', emit)
})
