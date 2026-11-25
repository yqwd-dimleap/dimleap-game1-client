import { _decorator, Component, Label } from 'cc';
import { ViewNodes } from '../binding/ViewNodes';

/** Read-only wallet view injected by the game layer; UI never reaches into game state. */
export interface CoinWallet {
    coins(): number;
    subscribe(listener: () => void): () => void;
}

let wallet: CoinWallet | undefined;

/** Bound once during app bootstrap so every PlayerGold instance stays in sync. */
export function bindCoinWallet(source: CoinWallet): void { wallet = source; }

/** Reusable currency chip: works wherever the prefab is placed, no per-page wiring. */
@_decorator.ccclass('PlayerGoldView')
export class PlayerGoldView extends Component {
    private bindings?: ViewNodes;
    private unsubscribe?: () => void;
    onEnable(): void {
        if (!wallet || this.unsubscribe) return;
        this.refresh();
        this.unsubscribe = wallet.subscribe(() => this.refresh());
    }
    onDisable(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
    render(coins: number): void {
        const ui = this.bindings ?? (this.bindings = new ViewNodes(this.node));
        ui.at('goldframe/coin_value', Label).string = String(coins);
    }
    private refresh(): void { if (wallet) this.render(wallet.coins()); }
}