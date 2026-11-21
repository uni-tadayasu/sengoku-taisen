'use strict';

// The three public reading pages are static HTML. This build helper is never
// required by a visitor and deliberately touches no game or hosting metadata.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'https://www.kasai-solutions-inc.com';
const release = '3.7.1-20261121';
// Update only for substantive content changes; never replace this with build time.
const modified = '2026-11-21';
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const section = (id, kicker, title, body, theme = '') => `<section id="${id}" class="article-section ${theme}"><div class="section-kicker">${kicker}</div><h2>${title}</h2>${body}</section>`;
const callout = (title, body, warm = false) => `<aside class="callout${warm ? ' callout--warm' : ''}"><h3>${title}</h3><p>${body}</p></aside>`;
const steps = items => `<ol class="step-list">${items.map(([title, text], index) => `<li><span class="step-marker" aria-hidden="true">${index + 1}</span><div><h3>${title}</h3><p>${text}</p></div></li>`).join('')}</ol>`;
const table = (caption, headings, rows, extra = '') => `<div class="data-table-wrap"><table class="${extra}"><caption>${caption}</caption><thead><tr>${headings.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(cells => `<tr>${cells.map((cell, i) => i === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

function paths(file) {
  const from = path.posix.dirname(file);
  return {
    file: target => path.posix.relative(from, target) || './',
    dir: target => `${path.posix.relative(from, target) || '.'}/`
  };
}

function guideContent(p) {
  return [
    section('first-steps', '初めての領主へ', '城下を育て、将を迎え、領国を広げる。', `
      <p class="lead-paragraph">「いざ、戦国へ」から始まる、あなただけの戦記。初めて遊ぶときは、はじまりの城を選びます。年月は、ほかのプレイヤーと同じ世界時計で動きます。</p>
      ${steps([
        ['はじまりの城を選ぶ', '初回の「いざ、戦国へ」で「はじまりの城を選ぶ」を開き、家・難易度・開始城を選びます。通常プレイヤーは大都市拠点（江戸・駿府・二条・大坂・名古屋）を除く123城から選び、「この城から始める」で確定します。最初に所持するのは選んだ1城だけです。認証済みの運営は江戸城、スタッフは德川家・駿府城に固定されます。'],
        ['城下町の生産を整える', '田畑で兵糧、商業施設で金を生産します。木材と石材も集め、施設を選んで普請を進めます。「全64施設を管理」では、軍備・研究・外交の施設まで確認できます。'],
        ['武将を迎えて役目を任せる', '武将を登用・招集し、最大3名を軍団に編成します。内政を支える奉行も任命できます。同じ武将を軍団へ重複して編成することはできません。'],
        ['天下地図で次の一城を選ぶ', '自領に隣接する城を選び、偵察や外交を活用します。出陣するときは兵数・戦法・予測を確認しましょう。城を増やすほど、守備や兵糧の管理も大切になります。']
      ])}
      <p>以前の続きへ戻る場合は、初回画面の<strong>「以前の領主・運営を復元」</strong>から引き継げます。城を確定する前の状態は保存・自動送信しません。すでに保存されている進行は、開始城選択の追加によって変わりません。</p>
      <p>通常城の城郭と城下町施設は<strong>Lv.32</strong>まで、大都市拠点（江戸・駿府・二条・大坂・名古屋）の城郭はその2倍の<strong>Lv.64</strong>まで発展します。城の強化に応じて費用と効果が変わります。詳細画面では32段階の絵姿を見比べられ、Lv.33以降は最終形態の絵を使います。イラストの閲覧だけで資源やレベルが変わることはありません。</p>
    `, 'section-town'),
    section('resources', '城下町と資源', '日々の生産が、次の一手を支える。', `
      <p>資源の所持数と収支を確認しながら、内政と軍備の配分を考えます。兵を増やすと維持する兵糧も必要です。普請・研究の完成を待つ間は、武将や地図を確認できます。普請・研究の進行欄には、経過時間・残り時間・進捗率を表示します。経過はゲーム内の進行時間、残りは現在の世界速度での待ち時間です。</p>
      ${table('5つの資源・通貨と主な用途', ['種類', '使い道'], [
        ['<span class="resource-gold">金</span>', '普請、武将の登用、募兵などに使う基本資源。'],
        ['<span class="resource-rice">兵糧</span>', '軍の維持や出陣に使用。収入だけでなく維持費との差引を確認します。'],
        ['<span class="resource-wood">木材</span>', '施設や城郭を発展させるための建築資源。'],
        ['<span class="resource-stone">石材</span>', '城郭・防衛施設などの整備に使う資源。'],
        ['<span class="resource-magatama">勾玉</span>', '武将招集に使用。月ごとの報酬、城の初回攻略、任務、運営からの贈り物などで獲得します。']
      ], 'resource-table')}
      <p>各施設の詳細には必要資源と効果が表示されます。普請枠は城郭と施設で共通です。着工前に、何を先に完成させたいかを決めておくと進めやすくなります。</p>
    `, 'section-town'),
    section('officers', '武将・軍団・勾玉', '256名の武将に、8つの姿。', `
      <p>武将名鑑では人物・所属・能力・特技を確認できます。各人物にDからUまでの8ランクがあり、衣装や装飾、構図の異なるイラストを収録しています。能力とランクはゲーム独自の設定です。</p>
      <ul class="rank-strip" aria-label="武将の8ランク"><li>D</li><li>C</li><li>B</li><li>A</li><li>S</li><li>SS</li><li>SSS</li><li>U</li></ul>
      <p>勾玉による武将招集は<strong>1回300、10回2,700</strong>です。現実のお金による勾玉の購入はありません。排出率と対象は招集画面で確認でき、10回招集の最低ランク保証・天井はありません。同じ人物・同じランクを重複して迎えたときは勾玉50に変わります。</p>
      <h3>軍団と奉行の役割を分ける</h3>
      <p>軍団の能力は戦いに、奉行の能力は施設の働きに関わります。兵数だけでなく、統率・武勇・知略や特技を見て編成します。奉行に任命した武将は軍団から外れるため、任せたい役目を選んでください。</p>
      ${callout('運営専用の武将', '運営が所持するUランクは「德川家康 U」と表記し、専用の特別イラストで表示します。このUランクは通常の招集対象に含まれません。')}
    `, 'section-officers'),
    section('maps', '天下地図と共通フィールド', '領国を広げる戦役。領主と向き合う戦場。', `
      <p>二つの地図は目的が異なります。天下地図ではCPU勢力との戦役を進め、共通フィールドではほかのプレイヤーの本拠を選んで交流・襲撃・外交を行います。</p>
      ${table('二つの地図の使い分け', ['画面', '相手と主な操作'], [
        ['天下地図', 'CPU勢力の城を選び、偵察・外交・出陣で領国を広げます。日本の地理データと128城の代表地点を用いて表示します。'],
        ['共通フィールド', 'クラウド保存済みの実際のプレイヤーの本拠を表示します。領主を個別に選び、限定襲撃や同盟の提案を行います。']
      ])}
      <p>通常プレイヤーは、運営専用の江戸城とスタッフ専用の駿府城を除く<strong>126城</strong>の統一を目指します。運営の本拠は江戸城、スタッフの本拠は駿府城に固定されます。この二つの専用拠点は一般プレイヤーが開始城に選べず、攻略・所持もできません。江戸・駿府・二条（京）・大坂・名古屋は大都市拠点に指定され、最初の城には選べません。二条・大坂・名古屋は、開始後に攻略できます。</p>
      <h3>共通フィールドの限定襲撃</h3>
      <p>出陣兵数と戦法を選び、確認して襲撃します。指令1回と兵糧を消費し、結果は双方の保存と戦報へ反映されます。現在の対人戦では本拠や武将の所有権は移りません。守備側の兵損は各兵数の10%以内、勝利時の略奪は各資源の5%以内かつ500以内です。</p>
      <p>攻撃後の待機と被襲撃後の保護は、共通時間で60秒。運営の江戸城、スタッフの駿府城、保護中の拠点には攻撃できず、世界時計の停止中も襲撃は行えません。</p>
      <h3>同盟は相手の承諾で成立</h3>
      <p>外交の提案を相手が承諾すると、<strong>ゲーム内の6か月間</strong>、互いに攻撃できなくなります。届いた提案の拒否や、未承諾の自分の提案の取消もできます。暦が一周して拠点をリセットするときは、前の暦で結んだ同盟・未承諾の外交提案も終了します。</p>
    `, 'section-field'),
    section('world-clock', '全プレイヤー共通の年月', '暦はめぐり、積み重ねは続いていく。', `
      <p class="lead-paragraph">世界時計は全プレイヤー共通です。1560年1月から1615年12月まで進むと、再び1560年1月へ戻ります。次の暦に入ると占領した拠点をリセットし、開始時に選んだ本拠から再出発します。運営は德川家・江戸城、スタッフは德川家・駿府城を維持します。駿府城の共有成長、武将・施設・所持資源は引き継ぎます。</p>
      <p>1倍速では<strong>実時間60秒がゲーム内の1か月</strong>に相当し、20秒ごとに指令が1回復します。世界全体の速度と停止・再開は運営が管理します。プレイヤー個人で年月を進めたり、一人だけ停止したりする操作はありません。</p>
      <p>画面を閉じている間も世界の時間は進み、再接続すると生産・普請・研究などを共通時刻まで反映します。通信を確認できない間は操作を待機し、接続が戻ったときに追いつきます。</p>
      <h3>占領した城の数に応じた報酬</h3>
      <p>暦が切り替わる直前に保有していた<strong>本拠以外の城1つにつき、勾玉100・金銭1,000・兵糧1,000</strong>を受け取ります。たとえば対象が5城なら、勾玉500・金銭5,000・兵糧5,000です。本拠は報酬の城数に含めません。</p>
      <p>連携済みの領主の報酬はサーバーで一度だけ確定します。同じ領主を複数端末で開いた場合や通信を再試行した場合も、同じ区切りの報酬を重ねて加算しません。留守中に区切りをまたいだ場合は、再接続時に進行と報酬を確認します。</p>
      <p>占領地の城郭・守備兵と占領地で未完了の増築はリセットされます。本拠の城郭、城下の施設・研究・武将・資源は残ります。天下地図のCPU勢力との同盟・偵察、共通フィールドの前の暦から続く外交関係は区切りで終了します。</p>
    `, 'section-clock'),
    section('community', '領主たちの交流', '世界の会話、仲間との軍議、友への文。', `
      <p>「交流」で領主名を登録すると、世界チャット、ギルド、フレンド、システム便などを使えます。「接続一覧」では現在オンラインの領主と所属・役職を確認できます。同じ領主の複数端末は一人にまとめて表示されます。</p>
      <p>接続状態は定期的に更新され、直近90秒以内に接続確認のあった領主をオンラインとして表示します。端末を閉じた直後などは、表示が変わるまで少し時間がかかります。</p>
      <h3>御触書と領主の達成</h3>
      <p>画面上部の「御触書」には運営のお知らせと、領主の名前付きの達成記録を表示します。「御触書」を押すか、「交流」→「御触書」を開くと、達成内容と日本時間の日時を一覧で読めます。30秒ごとに更新し、以前の知らせも確認できます。</p>
      <p>達成記録はサーバーに反映されたゲームの進行をもとに届けます。私信、ギルド金庫の明細、運営・スタッフ向けのログイン履歴は公開しません。</p>
      <h3>ギルドの役職と共有金庫</h3>
      <p>ギルドには「盟主」「副盟主」「メンバー」の役職があります。「交流」→「ギルド」→「役職・メンバー」で、盟主が副盟主を任命・解除できます。盟主と副盟主は通常メンバーを除名でき、副盟主は盟主や他の副盟主を除名できません。ギルド内の役職と、サイトの運営・スタッフ権限は別です。</p>
      <p>「共有金庫」では、金銭・兵糧・木材・石材・勾玉を納められます。全メンバーが「受け取って使用」で自分の所持資産へ移し、普請や募兵、武将招集などに使えます。残高と出し入れの記録は所属メンバーだけに共有されます。資産の移動には端末同期が必要です。金庫に資産を残したまま、最後のメンバーが脱退することはできません。</p>
      <h3>ギルドランキング</h3>
      <p>「交流」→「ギルド順位」で、所属プレイヤーの威信を合計した「総威信」の高い順にギルドを表示します。所属人数と保有城数も確認できます。表示中は30秒ごとに更新され、手動更新も可能です。ランキングには共有金庫の残高や出し入れの記録を公開しません。</p>
      <h3>あなたの領主アイコン</h3>
      <p>「交流」→「領主」から、端末の写真をアイコンにできます。丸いプレビューで位置・大きさを調整して保存すると、交流や接続一覧へ反映され、同じ領主の端末にも同期されます。標準アイコンへの戻しも可能です。</p>
      <h3>運営・スタッフのログイン履歴</h3>
      <p>運営とスタッフには「ログイン履歴」を表示します。過去24時間にログイン・接続を確認したメンバーを、最終接続の新しい順で確認できます。日時は日本時間で表示され、表示中は30秒ごとに更新します。一般プレイヤーは閲覧できません。</p>
      <h3>スタッフ全員で育てる駿府城</h3>
      <p>スタッフは、占領されない専用の<strong>駿府城</strong>を固定本拠とします。城郭レベルと城下町の64施設、進行中の共同普請を全スタッフで共有します。誰かが普請を始めると、共通時間で完成へ進み、成長を全スタッフの画面へ反映します。共有した成長は暦の区切りを越えて残ります。</p>
      <p>着工するスタッフが自分の所持資源を支払います。武将・軍団・研究・資源残高は領主ごとに管理します。共同普請にはスタッフ権限と接続確認が必要で、重複した着工や通信の再試行による二重の支払いを防ぎます。</p>
      <p>スタッフの家名と駿府城の所属は<strong>「德川家」</strong>に統一します。任命前の家名・個人本拠・個人施設は別に記録し、解任後は元の家と個人の進行へ戻します。武将・研究・所持資源はその領主が引き継ぎ、駿府城の共同成長はスタッフ共通の拠点に残ります。以前に一般プレイヤーとして駿府城を本拠にしていた領主は、個人の成長を引き継いで通常の城へ本拠を移します。</p>
      <h3>システム便と贈り物</h3>
      <p>運営は個別の領主または全プレイヤーへ、便りと金・兵糧・木材・石材・勾玉を届けられます。届いた便りは「システム便」で開き、「受け取る」で贈り物を受領します。受取記録により同じ贈り物の重複加算を防ぎます。</p>
      ${table('役職ごとの機能', ['役職', '主な機能'], [
        ['プレイヤー', '領国の運営、戦役、共通フィールド、通常のチャットやフレンド交流。'],
        ['スタッフ', '運営から任命されたサポート役。德川家・駿府城の占領されない固定本拠を全スタッフで育てます。運営チャットの閲覧・送信と、直近24時間のログイン履歴の閲覧もできます。'],
        ['運営', 'スタッフ任命・解任、御触書、システム便と贈り物、共通時間の管理。德川家・江戸城の固定本拠と、運営専用の德川家康U。']
      ])}
      <p>「德川家」は運営・スタッフの家名です。運営は德川家・江戸城、スタッフは德川家・駿府城に固定されます。通常の「徳川家」は一般プレイヤーも選べます。</p>
      <p>スタッフ任命だけでは、江戸城・德川家康U・時間操作・贈り物の配布・ほかのスタッフの任命権限は付与されません。役職はサーバーが確認し、同じ領主IDの端末へ反映します。</p>
    `, 'section-community'),
    section('save-and-sync', '端末同期とデータ保存', 'どの端末でも、同じ領主として。', `
      <p>城を選んで開始した後の未連携の進行は、そのブラウザに自動保存されます。未確定の城選択は保存・自動送信しません。領主登録・端末連携後はクラウドにも保存し、同じ領主IDの端末へ自動同期します。世界時計・同期・交流にはインターネット接続が必要です。</p>
      <p>進行を操作する端末は同時に1台です。ほかの端末は最新状態を表示し、操作権を切り替えて続きを遊べます。自動同期では開いている画面・スクロール位置・入力途中の内容を保ちます。通信が切れた場合や別の端末へ操作権が移った場合は、保存の競合を防ぐため操作を待機します。</p>
      ${callout('機種変更・URL変更の前に', '「領主データ」は同じ領主へ接続するための本人情報、「セーブデータ」は城・武将・資源などの進行です。「統合バックアップ」では両方をまとめて保管できます。')}
      <a class="chapter-link" href="${p.dir('guide/data-recovery')}">端末変更・データ復元の手順を読む</a>
    `),
    section('questions', 'よくある質問', '遊び始める前に知っておきたいこと。', `
      <div class="faq"><h3>PCとスマートフォンの両方で遊べますか？</h3><p>ブラウザから利用できます。PCでは画面全体の表示領域に合わせ、スマートフォンではタッチ操作向けに配置を調整します。同じ領主IDを連携すれば、端末を変えて続けられます。</p>
      <h3>開始する城を選べますか？</h3><p>初回の「はじまりの城を選ぶ」で、家・難易度・大都市拠点（江戸・駿府・二条・大坂・名古屋）を除く123城から開始城を選び、「この城から始める」で確定します。選んだ1城のみを所持して始まり、認証済みの運営は江戸城、スタッフは德川家・駿府城が固定本拠です。以前の続きは「以前の領主・運営を復元」から戻せます。</p>
      <h3>今の進行を別の城から始め直せますか？</h3><p>「保存・設定」から「新しい物語を始める」を選ぶと、開始城を選び直せます。確定すると現在の進行を新しい進行へ置き換え、置き換え前のセーブをバックアップとして保管します。今までの続きで遊ぶ場合は、この操作は不要です。</p>
      <h3>PCの表示領域は調節できますか？</h3><p>城下町は、左側に天守から手前の町並みまで全景を表示し、右側に施設の操作や進行状況をまとめています。左メニューの「領域を調整」を押すと、金色の境界をドラッグしてメニュー幅、上部の高さ、城下町・天下地図・共通フィールドの幅配分と表示高さを変えられます。境界を選んで矢印キーでも調整でき、「初期配置」で元に戻せます。配置はそのブラウザに保存されます。</p>
      <h3>画面の動きを控えめにできますか？</h3><p>ボタンやカードには、カーソルを合わせたときやクリック・タップしたときの反応があります。端末やブラウザの「動きを減らす」設定を有効にすると、位置移動・拡縮・波紋などを自動で抑え、色や枠線で操作状態を示します。</p>
      <h3>ほかのプレイヤーと、すべての城を奪い合いますか？</h3><p>天下地図の領国と戦役はプレイヤーごとのCPU戦です。共通フィールドでは実際の領主同士の限定襲撃と外交を行います。年月・接続状況・交流は全員で共有します。</p>
      <h3>音楽はどこで変更できますか？</h3><p>音符ボタンからBGMを有効にできます。16曲のオリジナルBGMを収録し、自動選曲、音楽帳からの手動選曲、音量調整に対応しています。</p><h3>スマホのマナーモード中も音を鳴らせますか？</h3><p>最初に再生ボタンをタップすると、対応するスマホ・タブレットではメディア再生としてBGMを鳴らします。端末のメディア音量を上げてください。ゲーム内で停止した音や音量0を勝手に解除することはありません。端末・ブラウザの再生制限によって音が出ない場合があります。</p></div>
      <a class="chapter-link" href="${p.dir('about')}">作品の収録内容・地図や家紋の出典を読む</a>
    `)
  ].join('\n');
}

function recoveryContent(p) {
  return [
    section('choose', '引き継ぎの入り口', '手元にあるものから、手順を選ぶ。', `
      <p class="lead-paragraph">以前の領主で接続できる端末、保存してあるバックアップ、領主データ、運営登録キー。どれが手元にあるかを確認すると、復元の手順が決まります。</p>
      <ul class="decision-list"><li><a href="#old-device"><strong>以前の領主で接続できる端末がある</strong><span>接続コードで引き継ぐ</span></a></li><li><a href="#complete-backup"><strong>統合バックアップを持っている</strong><span>1つのファイルを確認する</span></a></li><li><a href="#old-files"><strong>旧形式の領主データとセーブがある</strong><span>2つのファイルを使う</span></a></li><li><a href="#identity-only"><strong>領主データだけを持っている</strong><span>クラウド保存の有無を確認する</span></a></li><li><a href="#operator"><strong>初回に使用した運営登録キーがある</strong><span>元の運営の領主IDへ戻る</span></a></li><li><a href="#no-access"><strong>端末・領主データ・運営登録キーが見つからない</strong><span>復元できる範囲を確認する</span></a></li></ul>
      <p>引き継ぎはゲームの<strong>「交流」から「引き継ぎ」</strong>を開いて行います。「保存・設定」の「引き継ぎ・データ復元」、初回の城選択画面にある<strong>「以前の領主・運営を復元」</strong>からも同じ画面を開けます。まだ城を選んでいない状態が自動保存・自動送信されることはありません。</p>
    `),
    section('site-address', 'URL変更・機種変更と保存先', '新しく見えても、領主が消えたとは限りません。', `
      <p>ブラウザ内の保存領域（localStorage）は、サイトの<strong>オリジン</strong>ごとに分かれています。オリジンは、<code>https</code>などの方式、ドメイン名、ポートの組み合わせです。同じ作品でもURLのドメインが変わると、新しいページから旧サイトのブラウザ保存を直接読むことはできません。</p>
      <p>このサイトのURL変更によって、サーバー側の領主登録やクラウド保存が自動で削除されることはありません。新しい端末・新しいURLでは、以前の領主の本人情報を使って再接続します。</p>
      <div class="comparison"><section><h3>領主データ</h3><p>同じ領主IDへ接続するための情報です。フレンド、ギルド、郵便や、サーバーで管理される役職を確認するために使います。</p></section><section><h3>ゲームの進行</h3><p>城・武将・施設・資源などの記録です。クラウドに保存された進行、または手元のゲームセーブから戻します。</p></section></div>
      ${callout('領主データだけでは、すべての進行を戻せない場合があります', 'クラウドに進行がまだ保存されていないときは、以前のゲームセーブも必要です。以前の領主へ接続できたことと、以前の進行を復元できたことを別々に確認してください。', true)}
    `),
    section('old-device', '以前の端末が使える場合', '接続コードで、同じ領主を呼び戻す。', `
      ${steps([
        ['以前の領主で接続している端末を開く', '領主名・領主ID・進行を確認します。進行が旧端末にしかない場合に備え、ゲームセーブか統合バックアップも保管しておきます。'],
        ['接続コードを発行する', '旧端末の「交流」から「端末同期」を開き、「接続コードを発行」を選びます。コードの有効期限は10分で、使えるのは1回です。新しいコードを発行すると、以前の未使用コードは無効になります。'],
        ['新しいサイトでコードを入力する', '新しい端末・URLで「交流」から「引き継ぎ」を開き、発行された接続コードを入力します。同じ領主として接続できるか、サーバーで確認します。'],
        ['表示された進行を確認して接続する', 'クラウド保存がある場合は「サーバーの進行で接続」を選びます。クラウド保存がない場合は、以前のゲームセーブを追加して引き継ぎます。']
      ])}
      <p>期限切れ・使用済みのコードでは接続できません。旧端末でコードを発行し直してください。接続コードで新しい端末を連携しても、旧端末の認証はそのまま利用できます。</p>
    `),
    section('complete-backup', '領主と進行をまとめて保管', '統合バックアップから復元する。', `
      <p>統合バックアップは、<strong>領主の本人情報とゲームセーブを1つにまとめたファイル</strong>です。以前の領主で接続できるうちに、「引き継ぎ」の「統合バックアップを書き出す」で保管できます。「保存・設定」の「領主と進行をまとめて書き出す」も同じ機能です。</p>
      ${steps([
        ['「引き継ぎ」を開く', '「以前の領主・運営で再接続」の画面で、「領主データ・セーブを選ぶ」を押します。'],
        ['統合バックアップを選ぶ', '領主と進行をまとめて書き出したファイルを選択します。ファイルの内容と、サーバーに残っている領主・進行を確認します。'],
        ['復元元を確認して実行する', 'サーバーに進行があれば「サーバーの進行で接続」、サーバーに進行がなくファイルにセーブがあれば「このセーブを引き継ぐ」が表示されます。領主名と進行の概要を確認して実行します。']
      ])}
      <p>統合バックアップには本人として接続する情報が含まれます。自分の端末間の引き継ぎ用に保管し、公開チャットや共有ページへ添付しないでください。</p>
    `),
    section('old-files', '以前に書き出したファイルも利用可能', '旧形式の2つのファイルで引き継ぐ。', `
      <p>以前の「領主データ」と「セーブデータ」を別々に保管している場合も利用できます。「領主データ・セーブを選ぶ」で、同じ領主のファイルを選んでください。</p>
      ${table('以前のバックアップと役割', ['ファイル', '含まれる内容'], [
        ['「領主データを書き出す」で保存したJSON', '同じ領主へ再接続するための本人情報。これだけで城や資源の進行すべてが含まれるわけではありません。'],
        ['「セーブデータを書き出す」で保存したJSON', '城・武将・施設・資源などの進行。領主の本人情報や、運営権限を与える情報は含みません。']
      ])}
      <p>領主データを先に選び、クラウド保存がなかった場合は<strong>「ゲームセーブを追加する」</strong>からセーブを選べます。内容の概要を確認し、「このセーブを引き継ぐ」で進めてください。</p>
      <p>クラウドに進行がある場合は、その領主のサーバー上の最新保存を優先します。読み込んだ古いセーブで、クラウドの内容を自動的に置き換えることはありません。</p>
    `),
    section('cloud-priority', '確認画面の読み方', 'クラウドがあるかどうかで、復元元が変わる。', `
      ${table('確認後に表示される選択肢', ['保存状況', '操作と結果'], [
        ['サーバーに進行が保存されている', '「サーバーの進行で接続」。同じ領主のサーバー上の最新保存を読み込みます。統合バックアップに含まれる古い進行を自動で上書きしません。'],
        ['サーバーの進行はなく、ファイルにセーブがある', '概要を確認して「このセーブを引き継ぐ」。ファイルの進行を適用してから、同じ領主として自動同期へ進みます。'],
        ['サーバーの進行やセーブはなく、この端末に進行がある', '「ゲームセーブを追加する」で以前のセーブを確認するか、今この端末にある進行を使うことを明示的に確認して接続します。それまでは自動保存を始めません。'],
        ['サーバーにもこの端末にも進行がない・運営の本人確認済み', '「江戸城から新しく始めて接続」から、確認画面の「江戸城で新規開始して接続」で確定できます。江戸城1城からの新規開始で、以前の未保存の進行は復元されません。'],
        ['サーバーにもこの端末にも進行がない・一般プレイヤー', '以前のゲームセーブを追加するか、新たに始める場合は先に開始城を選ぶ画面へ進みます。城を選ぶ前の状態は自動保存・自動送信しません。']
      ])}
      <p>接続後は、領主名・所属・城・所持武将・資源が意図した状態か確認してください。進行できる端末は同時に1台です。別の端末が操作中なら、最新状態を確認してから操作権を切り替えます。</p>
    `),
    section('identity-only', '領主データだけがある場合', 'まず、サーバーの進行を確認する。', `
      <p>領主データだけでも、サーバーにクラウド保存があれば同じ領主と進行に戻れます。「領主データ・セーブを選ぶ」からファイルを読み込み、表示されるサーバー上の保存を確認してください。</p>
      <p>クラウド保存がない場合、以前の進行を戻すには以前のゲームセーブが必要です。「ゲームセーブを追加する」からファイルを追加して確認するか、ほかの進行を使うことを明示的に確認するまで、自動保存を始めません。</p>
      <h3>現在の端末の進行を使う選択</h3>
      <p>この端末にすでに進行があり、それを同じ領主へ保存したい場合は、<strong>「以前の進行を使わず、この端末の進行で接続する」</strong>を開き、「この端末の進行を確認する」から内容を確認して接続します。この操作は、失われた以前の進行を復元するものではありません。</p>
      <p>まだ開始城を選んでいない一般プレイヤーは、先に城を選ぶ画面へ案内されます。本人確認済みの運営には、次の項目にある江戸城からの新規開始が用意されています。</p>
    `),
    section('operator', '運営・スタッフの引き継ぎ', '役職は、同じ領主IDをサーバーで確認する。', `
      <p>運営・スタッフの役職は、サーバーに登録された領主IDへ結び付いています。以前の運営領主の接続コード、領主データ、統合バックアップを使い、同じ領主へ再接続してください。役職はサーバー上の現在の登録で再確認されます。</p>
      <h3>運営登録キーで元の運営へ戻る</h3>
      <p>以前の端末や領主ファイルがなくても、<strong>初回に使用した運営登録キー</strong>があれば、元の運営の領主IDへ再接続できます。登録済みの運営の復旧だけを行い、新しい領主に運営権限を付けることはありません。以前の端末の接続もそのまま利用できます。</p>
      ${steps([
        ['「運営登録キーで復旧」を開く', 'ゲームの「交流」から「引き継ぎ」を開き、「運営登録キーで復旧」へ進みます。'],
        ['初回に使用したキーを入力する', '「初回に使用した運営登録キー」のパスワード入力欄へキーを入れ、「運営権限の確認に進む」を押します。'],
        ['元の運営領主と進行を確認する', '表示された領主名・領主IDと役職を確認します。クラウド保存があれば「サーバーの進行で接続」を選び、元の進行を読み込みます。保存がない場合は以前のゲームセーブを追加できます。この端末に進行があれば、それを使うことを確認して接続することもできます。']
      ])}
      <h3>保存がない運営は、江戸城から新しく始められます</h3>
      <p>クラウド保存も、この端末の既存進行もない場合は、本人確認済みの運営に<strong>「江戸城から新しく始めて接続」</strong>が表示されます。確認画面の内容を読み、<strong>「江戸城で新規開始して接続」</strong>で確定すると、元の運営領主として江戸城1城から新たに始めます。確認前に新規進行を自動送信することはありません。</p>
      <p><strong>この新規開始では、以前の未保存の城・武将・資源・進行は戻りません。</strong>以前の進行を戻したい場合は、ゲームセーブを追加してください。一般プレイヤーがこの操作で江戸城や運営権限を得ることはなく、先に通常の開始城を選ぶ画面へ案内されます。</p>
      ${callout('権限の復旧と、進行の復元は別です', 'クラウド保存がある場合はサーバーの最新保存を優先します。未保存の場合、以前の城・武将・資源を戻すには以前のゲームセーブが必要です。セーブの読み込み、この端末の進行の利用、江戸城での新規開始は、使う進行を明示的に確認してから実行します。', true)}
      <h3>運営登録キーが見つからない場合</h3>
      <p>引き継ぎ画面の<strong>「運営登録キーが見つからない場合」</strong>を開き、以前の端末の接続コード、領主データ、または統合バックアップを使ってください。キーも以前の認証情報もない場合、この画面だけでは本人確認ができません。表示名・公開の領主ID・ゲームセーブだけでは運営権限を復旧できません。</p>
      <h3>江戸城と德川家康U</h3>
      <p>運営として確認されると、本拠は江戸城に固定され、専用の<strong>德川家康 U</strong>が特別イラストで反映されます。「保存・設定」の「德川家康 U を復元」から専用資産を確認・復元でき、繰り返し実行しても重複付与しません。</p>
      <p>スタッフは運営チャットを補助する役職です。スタッフとしての引き継ぎで、運営専用の江戸城や德川家康Uが付与されることはありません。</p>
    `),
    section('redirect', '旧URLが新URLへ転送される場合', '転送だけでは、旧ブラウザの保存は移りません。', `
      <p>旧URLから新しいURLへ自動で移動しても、新しいページが旧オリジンのlocalStorageを直接読むことはできません。新しいページを何度開き直しても、旧サイトだけに残っている保存が自動で見つかる仕組みではありません。</p>
      <p>以前から<strong>開いたままの旧ページ</strong>が使えるなら、再読み込みする前に領主データとセーブを書き出してください。旧URLで以前からインストール済みのアプリが、旧ページの保存を保ったまま利用できる場合もありますが、キャッシュやブラウザの状態により使えるかは異なります。</p>
      <p>旧ページを開けない場合は、保管済みの統合バックアップ、旧形式の2ファイル、または別の接続済み端末を使います。運営は初回に使用した運営登録キーからも元の運営領主へ戻れます。クラウド保存がある領主でも、本人として接続するための情報は必要です。</p>
    `),
    section('no-access', '復元できる範囲', '認証情報が見つからないとき。', `
      <p>接続済みの端末、領主データ、統合バックアップがなく、運営の場合は初回に使用した運営登録キーもない場合、この画面だけでは以前の領主本人として再接続できません。表示名や公開の領主IDだけでは、本人確認の代わりになりません。</p>
      <p>ゲームセーブだけでは、以前の領主ID・フレンド・運営権限を確認できません。領主データや接続コード、運営の場合は運営登録キーによる本人確認も必要です。サーバーの領主登録が残っていることと、認証できることは別です。</p>
      ${callout('復元できたら、次の引き継ぎに備える', '領主名・領主ID・進行を確認したあと、新しい統合バックアップを保管してください。古い端末を初期化したりブラウザの保存を消したりする前に、新しい端末で続きが開けることを確認します。')}
      <a class="chapter-link" href="${p.dir('guide')}">自動同期とゲームの遊び方を確認する</a>
    `)
  ].join('\n');
}

function aboutContent(p) {
  return [
    section('world', '作品について', '城を育て、将を集め、世界と時を重ねる。', `
      <p class="lead-paragraph">「戦国大戦」は、PC・スマートフォンのブラウザで遊ぶ戦国ストラテジーゲームです。城下町の内政、武将の登用、軍団の編成、天下地図の戦役を通じて、自分の領国を育てていきます。</p>
      <p>戦国期から近世初頭の人物と城を、年代を横断した「群雄集結」の設定で収録しています。歴史上の全武将を網羅した名簿ではなく、能力・特技・ランク・所属や勢力配置はゲーム向けの創作です。</p>
      <p class="quote-line">一城の志が、天下を動かす。</p>
      <p>全プレイヤーが共通の年月を歩み、世界チャットやギルド、共通フィールドで領主同士が出会います。世界時計は1560年1月から1615年12月までを繰り返します。区切りには占領拠点をリセットし、終わりに保有した本拠以外の城数に応じた報酬を受け取ります。選んだ本拠、武将・施設・所持資源は引き継ぎます。</p>
      <a class="chapter-link" href="${p.dir('guide')}">戦国大戦の遊び方を読む</a>
    `),
    section('collection', '収録内容', '一人の武将、一つの城に、重なる姿。', `
      ${table('人物・城郭・施設の収録規模', ['対象', '種類と段階', '基本画像数'], [
        ['武将', '256名 × 8ランク', '2,048'],
        ['城郭', '128城 × Lv.1〜32', '4,096'],
        ['施設', '64種類 × Lv.1〜32', '2,048'],
        ['オリジナルBGM', '16曲', '—']
      ])}
      <div class="collection-total"><b>8,192</b><span>武将・城郭・施設の基本イラスト</span></div>
      <p>8,192点は、配信用の画像シートに収めた各イラストの単位で数えています。画像ファイル数は256枚です。武将にはD・C・B・A・S・SS・SSS・Uの8ランク、城郭と施設には32段階の成長があります。</p>
      <p>音楽は箏・三味線・笛・笙・太鼓などをイメージして構成した、本作オリジナルの16曲。ブラウザ内で音を合成し、場面に合わせた自動選曲と音楽帳からの手動選曲に対応しています。</p>
    `),
    section('artwork', 'イラストと運営専用武将', 'ゲームの世界を描く、独自の表現。', `
      <p>武将は和風アニメ調、城や施設は発展が伝わる建築イラストとして制作しています。衣装・兜・装飾・背景・建物の構成を描き分けた、本作用の表現です。人物の実際の容姿や、城郭の厳密な復元図を示すものではありません。</p>
      <div class="art-feature"><figure><img src="${p.file('assets/operator-ieyasu-u.webp')}" alt="黒と深緑と金の甲冑をまとい、軍配を持つ運営専用の德川家康U" width="1024" height="1536" loading="lazy" decoding="async"><figcaption>運営専用の特別イラスト</figcaption></figure><div><h3>德川家康 U</h3><p>運営が所持するUランクには、黒・深緑・金の甲冑、葵の意匠、軍配、江戸城を背景にした専用の一枚絵を用意しています。表記は「德川家康 U」です。</p><p>この専用画像は8,192点の基本画像を維持したうえで表示時に差し替えます。通常の徳川家康の各ランクには影響せず、専用Uの所持はサーバーで確認した運営領主だけに認められます。</p></div></div>
      <ul class="source-list"><li><a href="${p.file('ARTWORK.md')}">イラストの構成と制作方針</a><small>画像数の数え方、ランク・成長段階、専用画像の取り扱い。</small></li><li><a href="${p.file('SOURCES.md')}">武将の収録方針・人物資料</a><small>全国から選抜した256名と、人物・所属・能力の扱い。</small></li></ul>
    `),
    section('geography', '天下地図の資料', '日本の山河と、城跡の位置をたどる。', `
      <p>天下地図は、公開された地理データと、城郭・史跡・施設の代表地点から描いています。日本の海岸線、標高に応じた段彩と陰影、参考県境、主要な河川・湖を重ねています。</p>
      <p>海岸線や標高は現代の地理資料です。戦国期の埋立て前の海岸線や旧国境を測量復元した地図ではありません。城の点は史跡・施設の代表地点で、天守や本丸の測量中心を意味しません。勢力配置と進軍経路はゲーム設定です。</p>
      <ul class="source-list"><li><a href="https://www.naturalearthdata.com/">Natural Earth</a><small>Made with Natural Earth. 海岸線・参考県境・河川・湖の地理データを加工して使用。Natural EarthのデータはPublic Domainです。</small></li><li><a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院・地理院タイル</a><small>地理院タイル（国土地理院）を加工して作成。標高タイルと陰影起伏図をもとに、段彩と陰影を合成しています。</small></li><li><a href="https://geoshape.ex.nii.ac.jp/nrct-poi/">『日本歴史地名大系』施設・地点項目データセット</a><small>CODH作成、doi:10.20676/00000456、CC BY 4.0。城の代表地点の確認に使用し、ゲーム内名称との対応付けと項目選択を行っています。</small></li><li><a href="https://ckan.odp.jig.jp/dataset/jp-fukui-280-odp">福井県 観光情報・オープンデータ</a><small>CC BY 2.1 JP。丸岡城・大野城の観光施設代表点を使用しています。</small></li><li><a href="${p.file('SOURCES-MAP.md')}">地図の全出典・利用条件・加工内容</a><small>128城の個別出典、地図データの精度と限界、提供元へのクレジット。</small></li></ul>
    `, 'section-map'),
    section('crests', '諸家の家紋と識別章', 'その家を知る、もう一つのしるし。', `
      <p>武将と城に登場する勢力へ、家紋または識別章を割り当てています。「家紋帳」では家名を検索し、代表意匠と採用理由、資料の確認状況を読めます。</p>
      <div class="crest-row"><figure><img src="${p.file('assets/kamon/oda.svg')}" alt="織田木瓜の略図" width="58" height="58" loading="lazy"><figcaption>織田家</figcaption></figure><figure><img src="${p.file('assets/kamon/takeda.svg')}" alt="武田菱の略図" width="58" height="58" loading="lazy"><figcaption>武田家</figcaption></figure><figure><img src="${p.file('assets/kamon/uesugi.svg')}" alt="上杉笹の略図" width="58" height="58" loading="lazy"><figcaption>上杉家</figcaption></figure><figure><img src="${p.file('assets/kamon/tokugawa.svg')}" alt="三つ葉葵の略図" width="58" height="58" loading="lazy"><figcaption>徳川家</figcaption></figure></div>
      <p>家紋は、資料の名称・構成を参考に独自に描いたゲーム用の略図です。時代・分家・人物・器物による異形を、一つの代表意匠として整理しています。「諸家」「在地衆」などの集合勢力には、ゲーム独自の群章を用いています。</p>
      <p>資料確認済み、伝承・二次資料、参考・創作の区分を分け、同定に限界がある意匠はその旨を記載しています。同じ基本図形を複数の家が使う場合もあります。</p>
      <a class="chapter-link" href="${p.file('SOURCES-KAMON.md')}">家紋・群章の対応表と出典を読む</a>
    `),
    section('copyright', '著作権と利用資料', '© KASAI SOLUTIONS', `
      <p>本サイトの著作権表記は<strong>KASAI SOLUTIONS</strong>です。ゲームの表示・説明・オリジナル素材のクレジットを、この名称で統一しています。</p>
      <p>地理データなどの第三者資料には、それぞれの提供元の利用条件が適用されます。地図上のクレジットと、地図・家紋・人物の各出典資料に、提供元・加工内容・参照先を記載しています。</p>
      <h3>データの引き継ぎについて</h3>
      <p>領主の認証情報とゲーム進行のバックアップ方法は、専用ページで案内しています。機種変更やサイトのURL変更をしたときは、同じ領主IDへ再接続して続きを確認してください。</p>
      <a class="chapter-link" href="${p.dir('guide/data-recovery')}">機種変更・ドメイン移行・データ復元の案内</a>
    `)
  ].join('\n');
}

const pages = [
  {
    file: 'guide/index.html', slug: 'guide', key: 'guide', label: '遊び方',
    title: '戦国大戦の遊び方｜城下町・武将・共通フィールド・自動同期',
    description: '戦国大戦の公式ガイド。城下町の育成、武将と軍団、天下地図、共通フィールド、周回時の拠点リセットと占領報酬、御触書、ギルド共有金庫・ランキング、端末同期と音声設定を説明します。',
    eyebrow: '戦国大戦の遊び方', heading: '一城から、<br><span>天下を描く。</span>',
    lead: '内政を整え、将を迎え、城を拓く。はじめての一歩から、世界の領主たちとの交流まで。あなたの戦記を進めるための案内です。',
    image: 'assets/castle-town.webp', imageWidth: 1536, imageHeight: 1024, imageAlt: '山々と川に囲まれ、田畑や商家が広がる戦国大戦の城下町イラスト', imageCaption: '城下町から始まる、あなたの領国。', imageTag: '城と群雄の戦記',
    heroAction: 'ゲームを開く', secondary: ['データ復元の案内', 'guide/data-recovery'],
    notes: [['遊ぶ場所', 'PC・スマートフォンのブラウザ'], ['世界の時間', '全プレイヤーで共通']],
    toc: [['first-steps','初めての進め方'],['resources','城下町と資源'],['officers','武将・軍団・勾玉'],['maps','二つの地図と外交'],['world-clock','共通の年月'],['community','接続一覧・交流・役職'],['save-and-sync','保存と端末同期'],['questions','よくある質問']],
    content: guideContent, closingTitle: 'さあ、城下町へ。', closingText: '最初の普請を選び、あなたの一手から戦記を始めましょう。'
  },
  {
    file: 'guide/data-recovery/index.html', slug: 'guide/data-recovery', key: 'recovery', label: 'データ復元',
    title: '戦国大戦のデータ復元・引き継ぎ｜機種変更とドメイン移行',
    description: '戦国大戦の機種変更・URL変更後のデータ復元を案内。接続コード、領主データとセーブ、統合バックアップ、運営登録キーによる元の運営IDの復旧とクラウド保存の確認を説明します。',
    eyebrow: '引き継ぎ・データ復元', heading: '同じ領主へ。<br><span>その歩みへ。</span>',
    lead: '端末を変えても、サイトのURLが変わっても。以前の領主と積み重ねた進行へ戻るために、手元のデータに合う手順を選びます。',
    image: 'assets/castle-town.webp', imageWidth: 1536, imageHeight: 1024, imageAlt: '城と町、田畑が一体になった戦国大戦の領国イラスト', imageCaption: '城・武将・資源の記録を、次の端末へ。', imageTag: '戦記を引き継ぐ',
    heroAction: 'ゲームを開いて引き継ぐ', secondary: ['手元のデータから選ぶ', '#choose'],
    notes: [['本人の確認', '領主データ・接続コード・運営登録キー'], ['進行の復元', 'クラウド保存・ゲームセーブ']],
    toc: [['choose','手元のデータから選ぶ'],['site-address','URL変更と保存先'],['old-device','接続コードで引き継ぐ'],['complete-backup','統合バックアップ'],['old-files','旧形式の2ファイル'],['cloud-priority','クラウドと復元元'],['identity-only','領主データだけの場合'],['operator','運営・スタッフの復元'],['redirect','旧URLが転送される場合'],['no-access','復元できる範囲']],
    content: recoveryContent, closingTitle: '以前の領主で、再接続する。', closingText: 'ゲームを開き、「交流」から「引き継ぎ」を選んでください。'
  },
  {
    file: 'about/index.html', slug: 'about', key: 'about', label: '作品情報',
    title: '戦国大戦について｜収録内容・地図と家紋の出典｜KASAI SOLUTIONS',
    description: 'KASAI SOLUTIONSの戦国大戦。256武将・8ランク・128城・64施設・8,192点の基本イラスト・16曲のBGMを収録。作品方針、実地形の地図、家紋と人物資料の出典を案内します。',
    eyebrow: '作品情報・収録・出典', heading: '城と群雄を、<br><span>ひとつの戦記に。</span>',
    lead: '山河に城を置き、諸家の旗を掲げる。戦国の題材と独自の表現を組み合わせた、本作の世界、収録内容、参考資料を紹介します。',
    image: 'assets/title-keyvisual.webp', imageWidth: 1774, imageHeight: 887, imageAlt: '二人の武将と日本の城郭を描いた戦国大戦のタイトルイラスト', imageCaption: '戦国大戦 — 城と群雄の戦記', imageTag: 'KASAI SOLUTIONS', wide: true,
    heroAction: 'ゲームを開く', secondary: ['遊び方を読む', 'guide'],
    notes: [['基本イラスト', '8,192点の武将・城郭・施設'], ['オリジナル音楽', '場面を彩る16曲']],
    toc: [['world','作品について'],['collection','収録内容'],['artwork','イラスト・德川家康U'],['geography','地図の資料と出典'],['crests','家紋と識別章'],['copyright','著作権・引き継ぎ']],
    content: aboutContent, closingTitle: '一城の志を、ここから。', closingText: '城下町の営みと、群雄たちの戦記をブラウザで。'
  }
];

function render(page) {
  const p = paths(page.file);
  const url = `${origin}/${page.slug}/`;
  const breadcrumbItems = [{name:'戦国大戦',url:`${origin}/`,href:p.dir('')}];
  if (page.key === 'recovery') breadcrumbItems.push({name:'遊び方',url:`${origin}/guide/`,href:p.dir('guide')});
  breadcrumbItems.push({name:page.label,url});
  const jsonld = {
    '@context':'https://schema.org',
    '@graph':[
      {'@type':'WebPage','@id':`${url}#webpage`,url,name:page.title,description:page.description,inLanguage:'ja',dateModified:modified,about:{'@id':`${origin}/#game`},isPartOf:{'@id':`${origin}/#website`},publisher:{'@type':'Organization',name:'KASAI SOLUTIONS',url:`${origin}/`},breadcrumb:{'@id':`${url}#breadcrumb`},primaryImageOfPage:{'@type':'ImageObject',url:`${origin}/${page.image}`}},
      {'@type':'BreadcrumbList','@id':`${url}#breadcrumb`,itemListElement:breadcrumbItems.map((item,i)=>({'@type':'ListItem',position:i+1,name:item.name,item:item.url}))}
    ]
  };
  const nav = [['guide','遊び方','guide'],['recovery','データ復元','guide/data-recovery'],['about','作品情報','about']].map(([key,label,slug])=>`<a href="${p.dir(slug)}"${page.key===key?' aria-current="page"':''}>${label}</a>`).join('');
  const secondaryHref = page.secondary[1].startsWith('#') ? page.secondary[1] : p.dir(page.secondary[1]);
  const imageFigure = `<figure class="hero-figure${page.wide?' hero-figure--wide':''}"><div class="hero-image-frame"><img src="${p.file(page.image)}" alt="${esc(page.imageAlt)}" width="${page.imageWidth}" height="${page.imageHeight}" fetchpriority="high" decoding="async"></div><figcaption><span>${page.imageCaption}</span><b>${page.imageTag}</b></figcaption><dl class="hero-note">${page.notes.map(([title,text])=>`<div><dt>${title}</dt><dd>${text}</dd></div>`).join('')}</dl></figure>`;
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
  <meta name="theme-color" content="#0c141f">
  <meta name="author" content="KASAI SOLUTIONS">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:site_name" content="戦国大戦｜KASAI SOLUTIONS">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${origin}/assets/ogp.jpg">
  <meta property="og:image:width" content="1774">
  <meta property="og:image:height" content="887">
  <meta property="og:image:alt" content="戦国大戦の武将と城郭を描いたタイトルイラスト">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(page.title)}">
  <meta name="twitter:description" content="${esc(page.description)}">
  <meta name="twitter:image" content="${origin}/assets/ogp.jpg">
  <meta name="twitter:image:alt" content="戦国大戦 — 城と群雄の戦記">
  <link rel="icon" href="${p.file('assets/favicon-32.png')}?v=${release}" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="${p.file('assets/apple-touch-icon.png')}?v=${release}">
  <link rel="stylesheet" href="${p.file('guide.css')}?v=${release}">
  <link rel="stylesheet" href="${p.file('interaction-motion.css')}?v=${release}">
  <script defer src="${p.file('interaction-motion.js')}?v=${release}"></script>
  <link rel="stylesheet" href="${p.file('image-protect.css')}?v=${release}">
  <script defer src="${p.file('image-protect.js')}?v=${release}"></script>
  <script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g,'\\u003c')}</script>
</head>
<body data-page="${page.key}">
  <a class="skip-link" href="#content">本文へ移動</a>
  <header class="site-header"><div class="site-header-inner page-width"><a class="site-brand" href="${p.dir('')}" aria-label="戦国大戦 ゲームのトップへ"><img src="${p.file('assets/icon-192.png')}?v=${release}" alt="" width="44" height="44"><span><b>戦国大戦</b><small>城と群雄の戦記</small></span></a><nav class="header-navigation" aria-label="サイトの案内">${nav}<a class="nav-play" href="${p.dir('')}">ゲームを開く</a></nav></div></header>
  <main id="content" class="page-width">
    <nav aria-label="パンくず"><ol class="breadcrumbs">${breadcrumbItems.map((item,i)=>`<li>${i===breadcrumbItems.length-1?`<span aria-current="page">${item.name}</span>`:`<a href="${item.href}">${item.name}</a>`}</li>`).join('')}</ol></nav>
    <section class="hero" aria-labelledby="page-title"><div class="hero-copy"><p class="eyebrow">${page.eyebrow}</p><h1 id="page-title">${page.heading}</h1><p class="hero-lead">${page.lead}</p><div class="hero-actions"><a class="action-link" href="${p.dir('')}">${page.heroAction}</a><a class="text-link" href="${secondaryHref}">${page.secondary[0]}</a></div></div>${imageFigure}</section>
    <div class="reading-layout"><aside class="toc"><nav aria-label="このページの目次"><p class="toc-title">このページの案内</p><ul>${page.toc.map(([id,label])=>`<li><a href="#${id}">${label}</a></li>`).join('')}</ul></nav><div class="toc-foot"><p>ブラウザで読む公式ガイド。</p><a href="${p.dir('')}">戦国大戦を開く</a></div></aside><article class="article" aria-label="${page.label}の本文"><p class="article-updated">内容更新：<time datetime="${modified}">2026年11月21日</time></p>${page.content(p)}</article></div>
    <section class="closing"><div><h2>${page.closingTitle}</h2><p>${page.closingText}</p></div><a class="action-link" href="${p.dir('')}">ゲームを開く</a></section>
  </main>
  <footer class="site-footer"><div class="footer-inner page-width"><p class="footer-brand">戦国大戦 <span>城と群雄の戦記</span></p><nav class="footer-nav" aria-label="フッターの案内">${nav}</nav><p class="copyright">© KASAI SOLUTIONS</p><p class="footer-note">地図・人物・家紋の資料は作品情報に記載しています。</p></div></footer>
</body>
</html>
`;
}

for (const page of pages) {
  const file = path.join(root, page.file);
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, render(page), 'utf8');
  console.log(`Wrote ${page.file}`);
}
