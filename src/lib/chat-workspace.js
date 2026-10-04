import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue';

/** Layout state never owns or cancels speech/model operations. */
export function useChatWorkspace(modalOpen) {
  const root = ref(null),
    panel = ref(null),
    settingsButton = ref(null);
  const wide = ref(false),
    desktopOpen = ref(true),
    drawerOpen = ref(false);
  const height = ref('calc(100dvh - 12rem)');
  const open = computed({
    get: () => (wide.value ? desktopOpen.value : drawerOpen.value),
    set: (value) => {
      if (wide.value) desktopOpen.value = value;
      else drawerOpen.value = value;
    },
  });
  const modal = computed(() => !wide.value && open.value);
  let observer,
    frame,
    previousOverflow = null,
    returnFocus;
  function measure() {
    if (!root.value?.isConnected) return;
    const rect = root.value.getBoundingClientRect();
    wide.value = rect.width >= 960;
    const viewport = window.visualViewport;
    const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
    // Once the workspace scrolls above the viewport, keep its size so docs below stay reachable.
    if (rect.top >= 0 && rect.top < bottom)
      height.value = `${Math.max(320, bottom - rect.top - 12)}px`;
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }
  function focusable() {
    return [
      ...(panel.value?.querySelectorAll(
        'button, select, textarea, input, summary, a[href], [tabindex]',
      ) || []),
    ].filter(
      (el) =>
        !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && !el.closest('[inert]'),
    );
  }
  function focusPanel() {
    (focusable()[0] || panel.value)?.focus();
  }
  function keydown(event) {
    if (!modal.value || modalOpen.value) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open.value = false;
    } else if (event.key === 'Tab') {
      const controls = focusable(),
        first = controls[0],
        last = controls.at(-1);
      if (
        !controls.length ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last) ||
        !panel.value?.contains(document.activeElement)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  }
  function containFocus(event) {
    if (modal.value && !modalOpen.value && !panel.value?.contains(event.target)) focusPanel();
  }
  function restoreBody() {
    if (previousOverflow !== null) {
      document.body.style.overflow = previousOverflow;
      previousOverflow = null;
    }
  }
  watch(modal, async (active) => {
    if (active) {
      returnFocus = settingsButton.value?.$el || document.activeElement;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      await nextTick();
      if (modal.value) focusPanel();
    } else {
      restoreBody();
      await nextTick();
      if (returnFocus) {
        (returnFocus.isConnected && !returnFocus.closest('[inert]')
          ? returnFocus
          : settingsButton.value?.$el
        )?.focus();
        returnFocus = null;
      }
    }
  });
  watch(wide, () => {
    drawerOpen.value = false;
  });
  watch(open, async (active, previous) => {
    if (!active && previous && wide.value && panel.value?.contains(document.activeElement)) {
      await nextTick();
      settingsButton.value?.$el?.focus();
    }
  });
  watch(modalOpen, async (active) => {
    if (!active && modal.value) {
      await nextTick();
      // The nested vd3 modal restores body scrolling; the outer drawer still owns it.
      document.body.style.overflow = 'hidden';
      focusPanel();
    }
  });
  onMounted(() => {
    measure();
    observer = new window.ResizeObserver(schedule);
    observer.observe(root.value);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', containFocus);
  });
  onActivated(schedule);
  onDeactivated(() => {
    drawerOpen.value = false;
    restoreBody();
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(frame);
    restoreBody();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('focusin', containFocus);
  });
  return { root, panel, settingsButton, wide, open, modal, height };
}
