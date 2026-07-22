<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import BottomNav from '$lib/components/BottomNav.svelte';

	let { children } = $props();
	let pageContentEl = $state<HTMLDivElement | null>(null);

	// Track scrolling to store position
	function handleScroll() {
		if (pageContentEl) {
			const path = window.location.pathname;
			localStorage.setItem(`ohdiary_scroll_${path}`, pageContentEl.scrollTop.toString());
		}
	}

	afterNavigate(({ to }) => {
		if (to) {
			const path = to.url.pathname;
			localStorage.setItem('ohdiary_last_path', path);

			const savedScroll = localStorage.getItem(`ohdiary_scroll_${path}`);
			if (savedScroll && pageContentEl) {
				setTimeout(() => {
					if (pageContentEl) {
						pageContentEl.scrollTop = parseInt(savedScroll, 10);
					}
				}, 60);
			} else if (pageContentEl) {
				pageContentEl.scrollTop = 0;
			}
		}
	});

	onMount(() => {
		const theme = localStorage.getItem('ohdiary_theme') || 'system';
		const root = document.documentElement;
		if (theme === 'dark') {
			root.classList.add('dark-mode');
			root.classList.remove('light-mode');
		} else if (theme === 'light') {
			root.classList.add('light-mode');
			root.classList.remove('dark-mode');
		}

		// Restore last visited route if opening on root '/'
		const currentPath = window.location.pathname;
		const lastPath = localStorage.getItem('ohdiary_last_path');
		if (lastPath && lastPath !== currentPath && currentPath === '/') {
			goto(lastPath);
		} else {
			// Restore scroll position on initial load
			const savedScroll = localStorage.getItem(`ohdiary_scroll_${currentPath}`);
			if (savedScroll && pageContentEl) {
				setTimeout(() => {
					if (pageContentEl) {
						pageContentEl.scrollTop = parseInt(savedScroll, 10);
					}
				}, 120);
			}
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
</svelte:head>

<div class="app-shell">
	<div class="page-content" bind:this={pageContentEl} onscroll={handleScroll}>
		{@render children()}
	</div>
	<BottomNav />
</div>

<style>
	.app-shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		max-width: 480px;
		margin: 0 auto;
		position: relative;
		background-color: var(--bg-primary);
		overflow: hidden;
	}

	.page-content {
		flex: 1;
		padding-bottom: var(--bottomnav-height);
		overflow-y: auto;
		height: 0; /* forces flex child to respect flex:1 and scroll instead of expand */
	}
</style>
