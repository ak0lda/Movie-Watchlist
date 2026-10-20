// jsdom has no layout: its window.scrollTo only logs "Not implemented". Screens call it on navigation.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
