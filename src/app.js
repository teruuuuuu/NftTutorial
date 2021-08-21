import React from "react";
import * as ReactDOM from "react-dom";
import './style.less';

const itemABI = require('../build/contracts/Item.json');
const Web3 = require('web3');
let web3js;

let syncAccountTimer;
let eventLogTimer;
let tailTimer;
let logBox = [];
let contracts = [];

// ローカルのIPFSノードに対してファイルアップロード
// ローカルのノードを他のノードにつながらないようにする設定とし、IPFSのGatewayもローカルに向けておく
const IPFS_GATEWAY_URL = "http://127.0.0.1:8080";
const IPFS_API_URL = "/ip4/127.0.0.1/tcp/5001";
const { create: ipfsHttpClient } = require('ipfs-http-client');
const ipfs = ipfsHttpClient(IPFS_API_URL);

export class App extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            mode: 1,
            account: undefined,
            contract: undefined,
            title: "",
            description: "",
            imgSrc: null,
            imgFile: null,
            imageUrl: null,
            added_file_cid: "",
            added_metadata_cid: "",
            eventLog: "",
            contractAddress: ['---'],
            tokenIds: ['---'],
            addressSelectedIndex: 0,
        };
        web3js = props.metamaskInstalled ? new Web3(web3.currentProvider) : undefined;
        this.init();
    }

    init() {
        const syncAccount = () => {
            if (syncAccountTimer) {
                clearInterval(syncAccountTimer);
            }
            syncAccountTimer = setInterval(() => {
                ethereum.request({ method: 'eth_requestAccounts' }).then(accounts => {
                    const { account, contract } = this.state;
                    if (account != accounts[0]) {
                        this.set({ account: accounts[0] });
                        if (!contract) {
                            this.contractDeploy();
                        }
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

    contractDeploy() {
        const contract = new web3js.eth.Contract(itemABI.abi);
        logBox.push("create contract.");
        contract.deploy({ data: itemABI.bytecode, arguments: [] })
            .send({
                from: this.state.account,
                gasPrice: 20000000000
            }, (error, transactionHash) => { })
            .on('error', (error) => {
                console.info(error);
            })
            .on('transactionHash', (transactionHash) => { })
            .on('receipt', (receipt) => {
                // logBox.push("receipt: " + receipt.itemABI);
                // console.log(receipt.itemABI) // contains the new contract address
            })
            .on('confirmation', (confirmationNumber, receipt) => { })
            .then((deployedContract) => {
                logBox.push(`create contract success: address[${deployedContract.options.address}]`);
                this.set({ contract: deployedContract.options.address });
                this.listen(deployedContract);
            });
    }

    listen(contract) {
        contract.events.allEvents({ filter: {} })
            .on("data", (event) => {
                if (event.event == "MintEvent") {
                    logBox.push(`mint event: account[${event.returnValues.player}] metadataUri[${event.returnValues.metadataURI}]`);
                }
            }).on("error", console.error);
    }


    making() {
        const { title, description, account, imgFile } = this.state;
        if (!account) {
            alert("アカウントが不明です")
        } else if (title.trim().length == 0 || description.trim().length == 0 || imgFile == null) {
            alert("入力が無効です")
        } else {
            logBox.push("make nft.");
            this.makeNft(account, imgFile, title, description);
        }
    }

    async makeNft(account, file, name, description) {
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
                this.mint(account, metadataUrl);
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

    mint(account, metadataURI) {
        logBox.push("mint.");
        const { contract } = this.state;
        let deployContract = new web3js.eth.Contract(itemABI.abi, contract);
        deployContract.methods.mintToken(account, metadataURI).send({ from: account })
            .on("receipt", (result) => {
                const { tokenIds } = this.state;
                const tokenId = result.events.Transfer.returnValues.tokenId;
                logBox.push(`mint tokenId[${tokenId}]`);
                console.info(result);
                this.setState({ tokenIds: tokenIds.concat(tokenId) });
            })
            .on("error", (error) => {
                console.error(error);
            });
    }

    changeMode(mode) {
        this.set(Object.assign(this.initState(), { mode: mode }));
    }

    changeTokenId(index) {
        const { contract, tokenIds } = this.state;
        if (index != 0) {
            const currentToken = tokenIds[index];
            let deployContract = new web3js.eth.Contract(itemABI.abi, contract);
            deployContract.methods.tokenURI(currentToken).call().then(metadataURI => {
                this.downloadMetadata(metadataURI);
            });
        }
        this.set(Object.assign(this.initState(), { addressSelectedIndex: index }));
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

    getInfo(contract) {
        logBox.push("send auction info request.");
        contract.methods.getInfo().call().then(info => {
            console.info(info);
            logBox.push(`get auction info: title[${info[0]}] description[${info[1]}]`)

            const title = info[0];
            const description = info[1];
            const end = info[6]
            this.set({ title: title, description: description });
        });
    }

    render() {
        const { metamaskInstalled } = this.props;
        const metamaskMessage = () => <div>Handle the case where the user doesn't have Metamask installed.<br />Probably show them a message prompting them to install Metamask.</div>
        return (
            metamaskInstalled ? this.appRender() : metamaskMessage()
        );
    }

    appRender() {
        const { account, contract, mode } = this.state;
        return (<div className="appArea">
            <div className="contentsArea">
                <div className="account">account: {account}</div>
                <div className="account">contract: {contract}</div>
                <div className="box">
                    <div className="header">
                        <div className={mode == 1 ? "mode on" : "mode"} onClick={() => this.changeMode(1)} >作成</div>
                        <div className={mode == 2 ? "mode on" : "mode"} onClick={() => this.changeMode(2)}>参照</div>
                    </div>
                    {mode == 1 ? this.makingRender() : this.biddingRender()}
                </div>
            </div>
            {this.eventLogRender()}
        </div>)
    }

    makingRender() {
        const { title, description, imgSrc, added_file_cid, added_metadata_cid } = this.state;
        return <div className="makingArea">
            <div className="makingForm">
                <div className="label">名前: </div><input className="input" type="text" value={title} onChange={e => this.set({ title: e.target.value })} />
                <div className="label">説明: </div><textarea className="textArea" value={description} onChange={e => this.set({ description: e.target.value })} />
                <div className="label">ファイル: </div><input type="file" accept="image/png, image/gif, image/jpeg" onChange={e => this.selectFile(e)} />
                <div></div><img className="thumbnail" accept="image/*" src={imgSrc}></img>
                <div className="label">file_cid: </div><input className="input" type="text" value={added_file_cid} readOnly />
                <div className="label">metadata_cid: </div><input className="input" type="text" value={added_metadata_cid} readOnly />
                <div></div><button className="button" onClick={() => this.making()}>確定</button>
            </div>
        </div>
    }

    biddingRender() {
        const { title, description, tokenIds, addressSelectedIndex, imageUrl } = this.state;
        return <div className="biddingArea">
            <div className="address">
                <div>トークンID:</div><select name="selectContract" value={addressSelectedIndex} onChange={e => this.changeTokenId(e.target.value)}>{tokenIds.map((address, index) => <option value={index} key={index} >{address}</option>)}</select>
            </div>
            <div className="makingForm">
                <div className="label">名前: </div><input className="input" type="text" value={title} readOnly />
                <div className="label">説明: </div><textarea className="textArea" value={description} readOnly />
                <div className="label">ファイル: </div><img className="thumbnail" accept="image/*" src={imageUrl}></img>
            </div>
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
    initState() {
        return {
            addressSelectedIndex: 0,
            title: "",
            description: "",
            imgSrc: null,
            imgFile: null,
            imageUrl: null,
            added_file_cid: "",
            added_metadata_cid: "",
        }
    }
    addEventLog(log) {
        this.set(Object.assign({}, this.state, { eventLog: this.state.eventLog + log }))
    }

    tail() {
        const fileScroll = ReactDOM.findDOMNode(this).getElementsByClassName(
            "logText"
        )[0];
        fileScroll.scrollTop = fileScroll.scrollHeight;
    }
}