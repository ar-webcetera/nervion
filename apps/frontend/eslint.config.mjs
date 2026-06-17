import withNuxt from "./.nuxt/eslint.config.mjs";

export default withNuxt({
  rules: {
    "vue/html-self-closing": "off",
    "func-style": ["error", "expression", { allowArrowFunctions: false }],
    "vue/no-multiple-template-root": "off",
  },
});
