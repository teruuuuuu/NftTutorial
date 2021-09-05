import React from "react";
import * as ReactDOM from "react-dom";
import './style.less';

// コントラクトの読み込み
const itemABI = require('../build/contracts/Item.json');
const Web3 = require('web3');

const isMetamaskInstalled = () => web3 !== 'undefined';
const getWeb3js = () => isMetamaskInstalled() ? new Web3(web3.currentProvider) : undefined;
// Metamaskで選択中のネットワークに対してコントラクトのデプロイを行います。開発中はGanacheに対してデプロイして確認しています。
let web3js = getWeb3js();

let syncAccountTimer;
let eventLogTimer;
let tailTimer;
let logBox = [];

// ローカルのIPFSノードに対してファイルアップロード
const IPFS_API_URL = "/ip4/127.0.0.1/tcp/5001";
const { create: ipfsHttpClient } = require('ipfs-http-client');
const ipfs = ipfsHttpClient(IPFS_API_URL);
// ローカルのノードを他のノードにつながらないようにする設定とし、IPFSのGatewayもローカルに向けておく
const IPFS_GATEWAY_URL = "http://127.0.0.1:8080";

// 出品
const MODE_LISTING = 1;
// 入札
const MODE_BIDDING = 2;

const UNSELECTED = "---";

export class App extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = Object.assign(this.genInitState(), {
            // Metamaskのアクティブアカウント
            account: undefined,
            // モード: 出品、入札
            mode: MODE_LISTING,
            // Metamaskのアカウントごとでデプロイしたコントラクト
            contracts: {},
            // MetamaskのアカウントごとでデプロイしたコントラクトのトークンIDのリスト
            tokenIds: {},
            eventLog: "",
        });
        this.init();
    }

    init() {
        const syncAccount = () => {
            if (syncAccountTimer) {
                clearInterval(syncAccountTimer);
            }
            syncAccountTimer = setInterval(() => {
                // Metamaskのアクティブなアカウントと同期させる
                ethereum.request({ method: 'eth_requestAccounts' }).then(accounts => {
                    const { account } = this.state;
                    if (account != accounts[0]) {
                        this.set(Object.assign(this.genInitState(), {
                            account: accounts[0]
                        }));
                    }
                });
            }, 1000);
        }
        const readEventLog = () => {
            if (eventLogTimer) {
                clearInterval(eventLogTimer);
            }
            eventLogTimer = setInterval(() => {
                if (logBox.length > 0) {
                    if (logBox[0].length > 0) {
                        this.addEventLog(logBox[0].slice(0, 1))
                        logBox[0] = logBox[0].slice(1)
                    } else {
                        this.addEventLog('\n')
                        logBox.shift()
                    }

                }
            }, 10);
        }
        const tailEventLog = () => {
            if (tailTimer) {
                clearInterval(tailTimer);
            }
            tailTimer = setInterval(() => {
                this.tail()
            }, 1000);
        }
        syncAccount();
        readEventLog();
        tailEventLog();
    }

    deploy(account) {
        const contract = new web3js.eth.Contract(itemABI.abi);
        logBox.push("create contract.");
        contract.deploy({ data: itemABI.bytecode, arguments: [] })
            .send({
                from: account,
                gasPrice: 20000000000
            }, (error, transactionHash) => { })
            .on('error', (error) => {
                console.info(error);
            })
            .on('transactionHash', (transactionHash) => { })
            .on('receipt', (receipt) => {
                logBox.push("receipt: " + receipt.itemABI);
            })
            .on('confirmation', (confirmationNumber, receipt) => { })
            .then((deployedContract) => {
                logBox.push(`create contract success: address[${deployedContract.options.address}]`);
                const { contracts } = this.state;
                contracts[account] = deployedContract.options.address;
                this.set({ contracts: contracts });
                this.listen(deployedContract);
            });
    }

    listen(contract) {
        contract.events.allEvents({ filter: {} })
            .on("data", (event) => {
                console.info(event.returnValues);
                if (event.event == "MintEvent") {
                    const { tokenId, creater, metadataURI, price, auctionEndTime } = event.returnValues;
                    logBox.push(`mint event: tokenId[${tokenId}] creater[${creater}] metadataUri[${metadataURI}] price(eth)[${price}] auctionEndTime[${new Date(1000 * auctionEndTime)}]`);
                } else if (event.event == "HighestBidIncreased") {
                    const { mode, selectContract, selectTokenId } = this.state;
                    const { tokenId, bidder, amount } = event.returnValues;
                    if (mode == MODE_BIDDING && selectContract.toLowerCase() == event.address.toLowerCase() && selectTokenId == tokenId) {
                        this.set({
                            highestBidder: bidder,
                            price: Web3.utils.fromWei(amount, 'ether')
                        });
                    }
                } else if (event.event == "AuctionEnded") {
                    const { mode, selectContract, selectTokenId } = this.state;
                    const { tokenId, bidder, amount } = event.returnValues;
                    if (mode == MODE_BIDDING && selectContract.toLowerCase() == event.address.toLowerCase() && selectTokenId == tokenId) {
                        this.set({
                            highestBidder: bidder,
                            price: Web3.utils.fromWei(amount, 'ether'),
                            auctionEnd: true
                        });
                    }
                } else if (event.event == "Transfer") {
                    const { mode, selectContract, selectTokenId } = this.state;
                    const { tokenId, from, to } = event.returnValues;
                    if (mode == MODE_BIDDING && selectContract.toLowerCase() == event.address.toLowerCase() && selectTokenId == tokenId) {
                        this.set({
                            tokenOwner: to
                        });
                    }
                }
            }).on("error", console.error);
    }


    listing() {
        const { title, description, account, imgFile, time, price } = this.state;
        if (!account) {
            alert("アカウントが不明です")
        } else if (title.trim().length == 0 || description.trim().length == 0 || imgFile == null) {
            alert("入力が無効です")
        } else {
            logBox.push("make nft.");
            this.makeNft(account, imgFile, title, description, time, price);
        }
    }

    async makeNft(account, file, name, description, time, price) {
        logBox.push("upload ipfs to image.");
        const added_file_cid = await this.saveToIpfs({ path: file.name, content: file });
        if (added_file_cid) {
            const imageUrl = `${IPFS_GATEWAY_URL}/ipfs/${added_file_cid}/${file.name}`;
            logBox.push(`upload ipfs to image cid[${added_file_cid}] url[${imageUrl}]`);
            logBox.push("upload ipfs to metadata.");
            const metadata_cid = await this.saveToIpfs({ path: 'metadata.json', content: JSON.stringify({ name, description, imageUrl: `${IPFS_GATEWAY_URL}/ipfs/${added_file_cid}/${file.name}` }) })
            if (metadata_cid) {
                const metadataUrl = `${IPFS_GATEWAY_URL}/ipfs/${metadata_cid}/metadata.json`;
                logBox.push(`upload ipfs to metadata cid[${metadata_cid}] url[${metadataUrl}]`);
                this.setState({ added_file_cid: added_file_cid, added_metadata_cid: metadata_cid });
                this.mint(account, metadataUrl, time, price);
            }
        }
    }

    async saveToIpfs(detail, option = { wrapWithDirectory: true, cidVersion: 1, hashAlg: 'sha2-256' }) {
        try {
            const added = await ipfs.add(detail, option)
            return added.cid.toString();
        } catch (err) {
            console.error(err)
        }
    }

    mint(account, metadataURI, time, price) {
        logBox.push("mint.");
        const { contracts } = this.state;
        let deployContract = new web3js.eth.Contract(itemABI.abi, contracts[account]);
        deployContract.methods.mintToken(metadataURI, web3js.utils.toWei(price.toString(), "ether"), time).send({ from: account })
            .on("receipt", (result) => {
                const { tokenIds } = this.state;
                const tokenId = result.events.Transfer.returnValues.tokenId;
                logBox.push(`mint tokenId[${tokenId}]`);
                console.info(result);
                tokenIds[contracts[account]] = Array.prototype.concat(tokenIds[contracts[account]] || [], tokenId);
                this.set({ tokenIds: tokenIds });
            })
            .on("error", (error) => {
                console.error(error);
            });
    }

    changeMode(mode) {
        this.set(Object.assign(this.genInitState(), { mode: mode }));
    }

    changeTokenId(selectContract, selectTokenId) {
        if (selectContract != UNSELECTED && selectTokenId != UNSELECTED) {
            let deployContract = new web3js.eth.Contract(itemABI.abi, selectContract);
            deployContract.methods.ownerOf(selectTokenId).call().then(tokenOwner => {
                this.set({ tokenOwner });
            });
            deployContract.methods.tokenURI(selectTokenId).call().then(metadataURI => {
                this.downloadMetadata(metadataURI);
            });
            deployContract.methods.getInfo(selectTokenId).call().then(ret => {
                this.set({
                    beneficiary: ret[0],
                    price: Web3.utils.fromWei(ret[1], 'ether'),
                    auctionEndTime: 1000 * ret[2],
                    highestBidder: ret[3],
                    auctionEnd: ret[4],
                    bidPrice: Web3.utils.fromWei(ret[1], 'ether')
                });
            });
        }
        this.set({ selectContract, selectTokenId });
    }

    downloadMetadata(metadataURI) {
        fetch(metadataURI)
            .then(response => response.json())
            .then(data => {
                this.setState({
                    title: data.name,
                    description: data.description,
                    imageUrl: data.imageUrl
                })
                console.log(data)
            });

    }

    bidding() {
        const { account, selectContract, selectTokenId, bidPrice } = this.state;
        if (selectContract != UNSELECTED && selectTokenId != UNSELECTED) {
            let deployContract = new web3js.eth.Contract(itemABI.abi, selectContract);
            logBox.push(`send bid. account[${account}] contract[${selectContract}] tokenId[${selectTokenId}] bidPrice[${bidPrice}]`);
            deployContract.methods.bid(selectTokenId).send({ from: account, value: web3js.utils.toWei(bidPrice, "ether") })
                .on("receipt", (result) => {
                    console.info(result);
                })
                .on("error", (error) => {
                    console.error(error);
                });
        }
    }

    auctionEnd() {
        const { account, selectContract, selectTokenId } = this.state;
        if (selectContract != UNSELECTED && selectTokenId != UNSELECTED) {
            let deployContract = new web3js.eth.Contract(itemABI.abi, selectContract);
            logBox.push(`send auction end. account[${account}] contract[${selectContract}] tokenId[${selectTokenId}]`);
            deployContract.methods.auctionEnd(selectTokenId).send({ from: account, value: 0 })
                .on("receipt", (result) => {
                    console.info(result);
                })
                .on("error", (error) => {
                    console.error(error);
                });
        }
    }

    render() {
        const metamaskMessage = () => <div>Handle the case where the user doesn't have Metamask installed.<br />Probably show them a message prompting them to install Metamask.</div>
        return (
            isMetamaskInstalled() ? this.appRender() : metamaskMessage()
        );
    }

    appRender() {
        const { account, mode } = this.state;
        return (<div className="appArea">
            <div className="contentsArea">
                <div className="account">account: {account}</div>
                <div className="box">
                    <div className="header">
                        <div className={mode == MODE_LISTING ? "mode on" : "mode"} onClick={() => this.changeMode(MODE_LISTING)} >出品</div>
                        <div className={mode == MODE_BIDDING ? "mode on" : "mode"} onClick={() => this.changeMode(MODE_BIDDING)}>購入</div>
                    </div>
                    {mode == MODE_LISTING ? this.listingRender() : this.biddingRender()}
                </div>
            </div>
            {this.eventLogRender()}
        </div>)
    }

    listingRender() {
        const { account, contracts, title, description, imgSrc, added_file_cid, added_metadata_cid, time, price } = this.state;
        return <div className="makingArea">
            <div className="address">
                <div>コントラクトアドレス:</div> {contracts.hasOwnProperty(account) ? <div>{contracts[account] || ""} </div> : <button className="button" onClick={() => this.deploy(account)} disabled={!account}>デプロイ</button>}
            </div>
            <div className="makingForm">
                <div className="label">名前: </div><input className="input" type="text" value={title} onChange={e => this.set({ title: e.target.value })} />
                <div className="label">説明: </div><textarea className="textArea" value={description} onChange={e => this.set({ description: e.target.value })} />
                <div className="label">ファイル: </div><input type="file" accept="image/png, image/gif, image/jpeg" onChange={e => this.selectFile(e)} />
                <div></div><img className="thumbnail" accept="image/*" src={imgSrc}></img>
                <div className="label">file_cid: </div><input className="input" type="text" value={added_file_cid} readOnly />
                <div className="label">metadata_cid: </div><input className="input" type="text" value={added_metadata_cid} readOnly />
                <div className="label">始値(eth): </div><input className="input" type="text" value={price} onChange={e => this.set({ price: e.target.value })} />
                <div className="label">出品時間(分): </div><input className="input" type="text" value={time} onChange={e => this.set({ time: e.target.value })} />
                <div></div><button className="button" onClick={() => this.listing()} disabled={!contracts.hasOwnProperty(account)}>出品</button>
            </div>
        </div>
    }

    biddingRender() {
        const { account, title, description, contracts, tokenIds, selectContract, selectTokenId, imageUrl, beneficiary, tokenOwner, highestBidder, price, auctionEndTime, bidPrice, auctionEnd } = this.state;
        return <div className="biddingArea">
            <div className="address">
                <div>コントラクトアドレス:</div><select name="selectContract" value={selectContract} onChange={e => this.set({ selectContract: e.target.value, selectTokenId: UNSELECTED })}>
                    <option value={UNSELECTED} >{UNSELECTED}</option>
                    {Object.keys(contracts).map(key => <option value={contracts[key]} key={key} >{contracts[key]}</option>)}
                </select>
                <div>トークンID:</div><select name="selectContract" value={selectTokenId} onChange={e => this.changeTokenId(selectContract, e.target.value)}>
                    <option value={UNSELECTED} >{UNSELECTED}</option>
                    {(tokenIds[selectContract] || []).map(tokenId => <option value={tokenId} key={tokenId} >{tokenId}</option>)}
                </select>
            </div>
            <div className="makingForm">
                <div className="label">名前: </div><input className="input" type="text" value={title} readOnly />
                <div className="label">説明: </div><textarea className="textArea" value={description} readOnly />
                <div className="label">ファイル: </div><img className="thumbnail" accept="image/*" src={imageUrl}></img>
                <div className="label">出品者: </div><input className="input" type="text" value={beneficiary} readOnly />
                <div className="label">所有者: </div><input className="input" type="text" value={tokenOwner} readOnly />
                <div className="label">入札者: </div><input className="input" type="text" value={highestBidder} readOnly />
                <div className="label">現価格(eth): </div><input className="input" type="text" value={price} readOnly />
                <div className="label">終了時刻: </div><input className="input" type="text" value={new Date(auctionEndTime)} readOnly />
                <div className="label">終了: </div><input className="input" type="text" value={auctionEnd} readOnly />
            </div>
            {
                account.toLowerCase() == tokenOwner.toLowerCase() ?
                    <div className="endForm"><button onClick={() => this.auctionEnd()} >終了</button></div> :
                    <div className="biddingForm">
                        <input type="number" value={bidPrice} onChange={e => this.set({ bidPrice: e.target.value })}></input><button disabled={selectTokenId == UNSELECTED} onClick={() => this.bidding()}>入札</button>
                    </div>
            }
        </div>
    }

    eventLogRender() {
        const { eventLog } = this.state;
        return <div className="eventLogArea">
            <textarea className="logText" readOnly value={eventLog} onScroll={() => this.tail()}></textarea>
        </div>
    }

    selectFile(e) {
        if (e.target.files.length > 0) {
            const reader = new FileReader();
            reader.onload = e => this.setState({ imgSrc: e.target.result });
            reader.readAsDataURL(e.target.files[0]);
            this.setState({ imgFile: e.target.files[0] });
        } else {
            this.setState({ imgSrc: null, imgFile: null });
        }
    }
    set(state) {
        this.setState(Object.assign({}, this.state, state))
    }
    genInitState() {
        return {
            // NFT名
            title: "",
            // NFT説明
            description: "",
            // 画像ソース
            imgSrc: null,
            // ファイル
            imgFile: null,
            // IPFS上のコンテンツURL
            imageUrl: null,
            // 画像のcid
            added_file_cid: "",
            // メタデータのcid
            added_metadata_cid: "",
            // 入札での選択中コントラクトアドレス
            selectContract: UNSELECTED,
            // 入札での選択中トークン
            selectTokenId: UNSELECTED,
            // 出品者
            beneficiary: "",
            // トークン所有者
            tokenOwner: "",
            // 最高額入札者
            highestBidder: "",
            // 出品時間
            time: 5,
            // 金額
            price: 0.001,
            //入札金額
            bidPrice: 0.001,
            // オークション終了時刻
            auctionEndTime: 0,
            // オークション終了フラグ
            auctionEnd: "false"
        }
    }
    addEventLog(log) {
        this.set({ eventLog: this.state.eventLog + log })
    }

    tail() {
        const fileScroll = ReactDOM.findDOMNode(this).getElementsByClassName(
            "logText"
        )[0];
        fileScroll.scrollTop = fileScroll.scrollHeight;
    }
}