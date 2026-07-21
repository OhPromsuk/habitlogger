<script lang="ts">
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { Clock, BookOpen, History, Settings } from "@lucide/svelte";

    const tabs = [
        { href: "/", label: "Habits", Icon: BookOpen },
        { href: "/timer", label: "Timer", Icon: Clock },
        { href: "/history", label: "History", Icon: History },
        { href: "/settings", label: "Settings", Icon: Settings },
    ];

    let activePath = $derived($page.url.pathname);

    function isActive(href: string) {
        if (href === "/") return activePath === "/";
        return activePath.startsWith(href);
    }
</script>

<nav class="bottom-nav">
    {#each tabs as tab}
        <a href={tab.href} class="nav-tab {isActive(tab.href) ? 'active' : ''}">
            <tab.Icon size={22} strokeWidth={isActive(tab.href) ? 2.5 : 2} />
            <span>{tab.label}</span>
        </a>
    {/each}
</nav>
