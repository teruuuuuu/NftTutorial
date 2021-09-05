pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract Item is ERC721, AccessControl {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    uint256 public auctionEndTime;
    // コントラクトオーナー(このコントラクトに対する出品はオーナーのみにする)
    address payable contractOwner;

    // トークン毎の最高入札額
    mapping(uint256 => uint256) private _highestBid;
    // トークン毎の入札終了時刻
    mapping(uint256 => uint256) private _auctionEndTime;
    // トークン毎の最高額入札者
    mapping(uint256 => address payable) private _highestBidder;
    // トークン毎のオークション終了フラグ
    mapping(uint256 => bool) private _auctionEnd;

    // コントラクトデプロイ時のイベント
    event ContractCreate(address creater);
    // NFTの鋳造時のイベント
    event MintEvent(
        uint256 tokenId,
        address creater,
        string metadataURI,
        uint256 price,
        uint256 auctionEndTime
    );
    // 入札時のイベント
    event HighestBidIncreased(uint256 tokenId, address bidder, uint256 amount);
    // オークション終了時のイベント
    event AuctionEnded(uint256 tokenId, address bidder, uint256 amount);

    constructor() public ERC721("Item", "ITM") {
        contractOwner = msg.sender;
        emit ContractCreate(contractOwner);
    }

    function mintToken(
        string memory metadataURI,
        uint256 price,
        uint256 time
    ) public returns (uint256) {
        require(
            contractOwner == msg.sender,
            "Mint is not Allowed except Contract Author."
        );

        _tokenIds.increment();

        uint256 newTokenId = _tokenIds.current();
        _mint(msg.sender, newTokenId);
        _setTokenURI(newTokenId, metadataURI);

        // 現在の入札額をセット
        _highestBid[newTokenId] = price;
        // 入札終了時刻をセット
        _auctionEndTime[newTokenId] = now + time * 60;
        // オークション終了フラグをセット
        _auctionEnd[newTokenId] = false;

        emit MintEvent(
            newTokenId,
            msg.sender,
            metadataURI,
            _highestBid[newTokenId],
            _auctionEndTime[newTokenId]
        );
        return newTokenId;
    }

    function bid(uint256 tokenId) public payable {
        require(
            now <= _auctionEndTime[tokenId] && !_auctionEnd[tokenId],
            "Auction already ended."
        );
        require(
            msg.value > _highestBid[tokenId],
            "There already is a higher bid."
        );
        require(
            _highestBidder[tokenId] != msg.sender,
            "You are already higher bidder."
        );
        require(ownerOf(tokenId) != msg.sender, "You are already Owner.");

        if (_highestBidder[tokenId] != address(0)) {
            // 現在の最高額入札者に返金
            _highestBidder[tokenId].transfer(_highestBid[tokenId]);
        }
        _highestBidder[tokenId] = msg.sender;
        _highestBid[tokenId] = msg.value;
        emit HighestBidIncreased(tokenId, msg.sender, msg.value);
    }

    function auctionEnd(uint256 tokenId) public {
        require(
            now >= _auctionEndTime[tokenId],
            "Not yet the aouction End time."
        );
        require(!_auctionEnd[tokenId], "Auction is already Ended.");
        require(
            ownerOf(tokenId) == msg.sender,
            "Only Token Owner can end the auction."
        );

        _auctionEnd[tokenId] = true;
        emit AuctionEnded(
            tokenId,
            _highestBidder[tokenId],
            _highestBid[tokenId]
        );

        if (_highestBidder[tokenId] != address(0)) {
            // トークン所有者に8割送金
            address payable _tokenOwner = address(uint160(ownerOf(tokenId)));
            _tokenOwner.transfer((_highestBid[tokenId] * 8) / 10);
            // 出品者に2割送金
            contractOwner.transfer((_highestBid[tokenId] * 2) / 10);
        }
    }

    function getInfo(uint256 tokenId)
        public
        view
        returns (
            address,
            uint256,
            uint256,
            address,
            bool
        )
    {
        return (
            contractOwner,
            _highestBid[tokenId],
            _auctionEndTime[tokenId],
            _highestBidder[tokenId],
            _auctionEnd[tokenId]
        );
    }
}
