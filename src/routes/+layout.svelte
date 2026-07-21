<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import BottomNav from '$lib/components/BottomNav.svelte';

	let { children } = $props();

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
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
</svelte:head>

<div class="app-shell">
	<div class="page-content">
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
