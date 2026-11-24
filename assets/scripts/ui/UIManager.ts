import { Label } from 'cc';
import { ViewNodes } from './binding/ViewNodes';
/** Small scene-local popup controller, with authored nodes retained in the editor. */
export class UIManager {
    constructor(private ui: ViewNodes) {}
    show(title: string, message: string): void {
        this.ui.at('Popup/Title', Label).string = title;
        this.ui.at('Popup/Message', Label).string = message;
        this.ui.path('Popup').active = true;
    }
    close(): void { this.ui.path('Popup').active = false; }
}
